-- 0009_client_avatars.sql. Client images (upload or URL), with a public bucket.

alter table clients add column avatar_url text;

-- public bucket for client avatars
insert into storage.buckets (id, name, public)
values ('client-avatars', 'client-avatars', true)
on conflict (id) do nothing;

-- anyone can read; signed-in users can upload/replace/remove
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='client avatars read') then
    create policy "client avatars read" on storage.objects for select using (bucket_id = 'client-avatars');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='client avatars write') then
    create policy "client avatars write" on storage.objects for insert to authenticated with check (bucket_id = 'client-avatars');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='client avatars update') then
    create policy "client avatars update" on storage.objects for update to authenticated using (bucket_id = 'client-avatars');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='client avatars delete') then
    create policy "client avatars delete" on storage.objects for delete to authenticated using (bucket_id = 'client-avatars');
  end if;
end $$;
