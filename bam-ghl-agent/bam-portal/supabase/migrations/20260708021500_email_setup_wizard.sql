-- Branded email domain wizard state (api/email/domain-setup.js). Applied to
-- prod 2026-07-08. On Resend verification the wizard sets email_domain and
-- flips email_provider='resend'.
alter table clients add column if not exists email_setup jsonb;
comment on column clients.email_setup is 'Branded email domain wizard state: { resend_domain_id, domain, records[], status, created_at }. Driven by api/email/domain-setup.js; on Resend verification the wizard sets email_domain + flips email_provider=resend.';
