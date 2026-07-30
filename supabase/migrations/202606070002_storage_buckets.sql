insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('user-images', 'user-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('club-images', 'club-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('gacha-images', 'gacha-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public image reads" on storage.objects;
create policy "public image reads"
on storage.objects for select
to anon, authenticated
using (bucket_id in ('user-images', 'club-images', 'gacha-images'));

drop policy if exists "authenticated user image uploads" on storage.objects;
create policy "authenticated user image uploads"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'user-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "authenticated user image updates" on storage.objects;
create policy "authenticated user image updates"
on storage.objects for update
to authenticated
using (
  bucket_id = 'user-images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'user-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Club and gacha asset writes stay server-side. Add service-role upload routes
-- when club authentication and the operations console are introduced.
