-- Public bucket for presentation helper uploads
insert into storage.buckets (id, name, public)
values ('pres-uploads', 'pres-uploads', true)
on conflict (id) do nothing;

-- Anyone can read (public bucket)
do $$ begin
  create policy "pres-uploads public read"
  on storage.objects for select
  using (bucket_id = 'pres-uploads');
exception when duplicate_object then null; end $$;

-- Anyone can upload (anon parties, no auth)
do $$ begin
  create policy "pres-uploads anon insert"
  on storage.objects for insert
  with check (bucket_id = 'pres-uploads');
exception when duplicate_object then null; end $$;
