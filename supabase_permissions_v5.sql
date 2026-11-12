-- Optional security hardening, recommended before class use.
-- Assumes existing public.city_objects, public.city_settings, and private city-models bucket.
-- Run as project SQL editor admin, not in the browser.

-- Ensure browser read access is possible with anonymous sign-in and remains RLS protected.
drop policy if exists "View city objects" on public.city_objects;
create policy "View city objects" on public.city_objects
 for select to authenticated using (true);

-- Restrict inserts to the uploader's unique Storage path and class editing window.
drop policy if exists "Add objects during class" on public.city_objects;
create policy "Add objects during class" on public.city_objects
 for insert to authenticated
 with check (
  coalesce((select editing_enabled from public.city_settings where id=1),false)
  and created_by=(select auth.uid())
  and model_path ~ ('^' || (select auth.uid())::text || '/[0-9a-f-]{36}\.obj$')
  and char_length(name) between 1 and 100
  and scale > 0 and scale <= 100
 );

-- Only transformation columns can be updated. Students cannot delete or replace the file path.
revoke update on public.city_objects from authenticated;
grant update(position_x,position_y,position_z,rotation_y,scale) on public.city_objects to authenticated;
revoke delete on public.city_objects from authenticated;

-- Require editing enabled to modify a row, including both before and after update.
drop policy if exists "Edit objects during class" on public.city_objects;
create policy "Edit objects during class" on public.city_objects
 for update to authenticated
 using (coalesce((select editing_enabled from public.city_settings where id=1),false))
 with check (coalesce((select editing_enabled from public.city_settings where id=1),false)
   and scale > 0 and scale <= 100);

-- Make changes to teacher-only settings unreadable to anonymous API clients except for SELECT.
revoke insert,update,delete on public.city_settings from anon,authenticated;
grant select on public.city_settings to authenticated;

-- If you want to disable read access to unjoined users, add an access-code gate later.

-- Receive teacher ON/OFF changes without a page refresh.
do $$ begin
 if not exists (
   select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='city_settings'
 ) then
   alter publication supabase_realtime add table public.city_settings;
 end if;
end $$;
