-- ═══════════════════════════════════════════════════════════════════════
-- SIGNED ENROLLMENT AGREEMENTS
--
-- Before this, a signed enrollment produced a PDF built from clauses
-- hardcoded in the portal (BAM GTA's waiver), regardless of what the parent
-- actually read on the academy's site. There was no record of WHICH wording
-- was signed, and the opt-in choices in the document (photo/video release)
-- were displayed but never captured.
--
-- Two tables fix that:
--
--   agreement_documents  a published, version-stamped copy of an academy's
--                        terms. Immutable: editing an academy's agreement
--                        publishes a NEW row with a new version_id, so a
--                        past member's terms can never be rewritten.
--
--   member_agreements    what one parent actually signed: which version, the
--                        signature, when, their opt-in choices, and the data
--                        that was filled into the document.
--
-- Source of the terms: bam-client-sites/clients/<slug>/agreement.terms.json,
-- published with bam-portal/scripts/publish-agreement.mjs.
-- ═══════════════════════════════════════════════════════════════════════

-- ── The published terms ────────────────────────────────────────────────
create table if not exists public.agreement_documents (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  doc_id         text not null,          -- stable per academy, e.g. "bam-san-jose-enrollment"
  version_id     text not null,          -- sha256 over the canonical terms
  revision       text,                   -- human label the terms file carries
  terms          jsonb not null,         -- the whole terms document, as published
  is_current     boolean not null default true,
  published_at   timestamptz not null default now(),
  published_by   text,
  created_at     timestamptz not null default now()
);

comment on table public.agreement_documents is
  'Version-stamped copies of each academy''s enrollment agreement. One row per published version; never updated in place. The portal renders the signed PDF from the row matching the version_id the parent''s browser displayed.';
comment on column public.agreement_documents.version_id is
  'sha256 over the canonical terms (see api/_lib/agreement-version.js). Any change to any word yields a new id.';
comment on column public.agreement_documents.is_current is
  'True for the latest published version of a doc_id. Older versions stay readable so past members keep their terms.';

create unique index if not exists agreement_documents_version_uniq
  on public.agreement_documents (client_id, doc_id, version_id);
create index if not exists agreement_documents_current_idx
  on public.agreement_documents (client_id, doc_id) where is_current;

-- Only one current version per (client, doc).
create or replace function public.agreement_documents_single_current()
returns trigger language plpgsql
set search_path = '' as $$
begin
  if new.is_current then
    update public.agreement_documents
       set is_current = false
     where client_id = new.client_id
       and doc_id    = new.doc_id
       and id       <> new.id
       and is_current;
  end if;
  return new;
end $$;

drop trigger if exists trg_agreement_documents_single_current on public.agreement_documents;
create trigger trg_agreement_documents_single_current
  after insert or update of is_current on public.agreement_documents
  for each row execute function public.agreement_documents_single_current();

-- The published terms are a legal record: block edits to the wording itself.
-- Republishing means inserting a new row, not rewriting an old one.
create or replace function public.agreement_documents_immutable()
returns trigger language plpgsql
set search_path = '' as $$
begin
  if new.terms is distinct from old.terms
     or new.version_id is distinct from old.version_id
     or new.doc_id     is distinct from old.doc_id
     or new.client_id  is distinct from old.client_id then
    raise exception 'agreement_documents rows are immutable; publish a new version instead';
  end if;
  return new;
end $$;

drop trigger if exists trg_agreement_documents_immutable on public.agreement_documents;
create trigger trg_agreement_documents_immutable
  before update on public.agreement_documents
  for each row execute function public.agreement_documents_immutable();

-- ── What one parent signed ─────────────────────────────────────────────
create table if not exists public.member_agreements (
  id                    uuid primary key default gen_random_uuid(),
  member_id             uuid not null references public.members(id) on delete cascade,
  client_id             uuid not null references public.clients(id) on delete cascade,
  agreement_document_id uuid references public.agreement_documents(id) on delete restrict,
  doc_id                text,
  version_id            text not null,
  signed_at             timestamptz not null,
  signature_path        text,            -- member-files path of the signature PNG
  pdf_path              text,            -- member-files path of the completed signed PDF
  consents              jsonb not null default '{}'::jsonb,  -- { media_release: "allow" | "deny", ... }
  filled                jsonb not null default '{}'::jsonb,  -- the data rendered into the document
  client_version_id     text,            -- version the browser said it displayed
  version_matched       boolean,         -- false = the site was ahead of what was published
  source                text not null default 'website-enrollment',
  created_at            timestamptz not null default now()
);

comment on table public.member_agreements is
  'One row per signed enrollment agreement: which published version the parent signed, their signature, their opt-in choices, and the data filled into the document. The artifact staff opens is pdf_path.';
comment on column public.member_agreements.consents is
  'The opt-in choices the parent actually made, keyed by the consent key in the terms document. media_release = "deny" means marketing must not use that athlete''s image.';
comment on column public.member_agreements.version_matched is
  'False when the academy site displayed a version that was never published. The signed record still stores what was verified; investigate before relying on it.';

create index if not exists member_agreements_member_idx  on public.member_agreements (member_id, signed_at desc);
create index if not exists member_agreements_client_idx  on public.member_agreements (client_id, signed_at desc);
-- Fast "who declined photo/video" lookups for marketing.
create index if not exists member_agreements_consents_idx on public.member_agreements using gin (consents);

-- ── Convenience: the current consent position per member ───────────────
-- Latest signed agreement wins, so a re-signed agreement updates the answer.
-- security_invoker: without it a view runs as its OWNER and bypasses the row
-- level security on member_agreements, letting any authenticated user read
-- every academy's consent data. Also set by 20260726022844 on the live
-- project, which was created before this line existed.
create or replace view public.member_consents
  with (security_invoker = on) as
select distinct on (ma.member_id)
  ma.member_id,
  ma.client_id,
  ma.consents,
  (ma.consents ->> 'media_release') as media_release,
  ((ma.consents ->> 'media_release') is distinct from 'deny') as media_allowed,
  ma.signed_at,
  ma.version_id
from public.member_agreements ma
order by ma.member_id, ma.signed_at desc;

comment on view public.member_consents is
  'The consent choices currently in force for each member (latest signed agreement wins). media_allowed is false only when the parent explicitly declined, so a member with no recorded choice is not treated as having opted out.';

-- ── RLS ────────────────────────────────────────────────────────────────
-- Staff read/write; an academy sees its own rows. All writes in practice go
-- through the service-role checkout API; the policies are defense in depth.
alter table public.agreement_documents enable row level security;

drop policy if exists agreement_documents_staff_rw on public.agreement_documents;
create policy agreement_documents_staff_rw on public.agreement_documents
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists agreement_documents_client_read on public.agreement_documents;
create policy agreement_documents_client_read on public.agreement_documents
  for select to authenticated
  using (client_id in (select public.my_client_ids()));

alter table public.member_agreements enable row level security;

drop policy if exists member_agreements_staff_rw on public.member_agreements;
create policy member_agreements_staff_rw on public.member_agreements
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists member_agreements_client_read on public.member_agreements;
create policy member_agreements_client_read on public.member_agreements
  for select to authenticated
  using (client_id in (select public.my_client_ids()));
