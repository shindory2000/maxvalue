-- Align the user-images bucket with the media types accepted by the application.
-- Profile photos may be HEIC/HEIF and verification videos may be up to 30 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-images',
  'user-images',
  true,
  31457280,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'video/webm',
    'video/mp4',
    'video/quicktime'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
