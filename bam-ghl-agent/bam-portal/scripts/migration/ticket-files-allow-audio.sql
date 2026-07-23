-- Audio-as-assets (Zoran 2026-07-20): let audio deliverables upload to the
-- ticket-files bucket. That bucket has a MIME allowlist that excluded audio;
-- add every common audio type. Additive + idempotent (array_agg(distinct ...)).
-- The client-assets bucket is unrestricted, so raw audio imports already work.
-- No-op if the bucket allows all (allowed_mime_types is null).
update storage.buckets
set allowed_mime_types = (
  select array_agg(distinct m) from unnest(
    allowed_mime_types || array[
      'audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/wave',
      'audio/mp4','audio/x-m4a','audio/m4a','audio/aac','audio/ogg',
      'audio/oga','audio/webm','audio/flac','audio/x-flac','audio/3gpp',
      'audio/amr','audio/opus','audio/basic'
    ]
  ) m
)
where id = 'ticket-files' and allowed_mime_types is not null;
