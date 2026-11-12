# Pink Lorax Town — collaborative prototype V5

This GitHub Pages website now uses Supabase anonymous browser sessions, Storage, Postgres and Realtime.

- Everyone with the URL can explore the base city and view shared models.
- While `city_settings.editing_enabled` is true, any visitor with an anonymous session can upload OBJ/MTL files and move/rotate/resize **any** contributed model.
- Files are saved to the private `city-models` storage bucket under `<auth.uid()>/<uuid>.obj` and `.mtl`.
- Shared transforms are stored in `city_objects`; other browsers receive changes via Postgres Realtime. A tab refocus also resyncs models.
- The original `assets/tinker.obj` city cannot be edited. No deletion UI; teacher can delete database rows in Supabase.

## Publish
Upload **all files from this directory** to your GitHub Pages repository, or just replace `index.html`, `app.js`, `style.css` if assets already match. GitHub Pages redeploys automatically after commit.

## Important teacher setup / security
1. Leave `city_settings.editing_enabled = false` until class begins.
2. Run the `supabase_permissions_v5.sql` migration from your Supabase SQL editor **before classroom use**. This tightens model-path and author validation and enforces immutable model identity; it also handles repeat deploys safely.
3. Confirm anonymous sign-ins are enabled and Supabase Realtime includes `city_objects` (and ideally `city_settings`). You already enabled the city_objects publication.
4. To start class: `update public.city_settings set editing_enabled=true,updated_at=now() where id=1;` Reverse to false at the end.
5. Anyone who finds the website can edit while the switch is ON; this is not strictly class-only access. Consider a class code or authenticated teacher-gated sessions for sensitive deployments. Monitor storage usage and retain city backups.
6. Requires network access to `cdn.jsdelivr.net` and Supabase. OBJ+MTL material colors are supported; external texture images are not.
7. The app uses latest-write-wins for overlapping edits: no temporary locks yet. Don’t let two students drag the same model simultaneously.

## Limitations
- No delete button for students; teacher may delete records using Supabase dashboard (uploaded blobs remain until cleaned manually).
- OBJ models are centered and oriented for the viewer. Every imported object is standalone.
- Initial load can be slow on low-powered Chromebooks. Changes save at the end of a gizmo drag or on field/button edits.
- No robust server-side malware/content inspection; the app and storage restrict extensions/size, but text OBJ can still be huge or malformed.

V6: Raise/Lower moved into a sticky section at top of Build panel, with trackpad instructions clarified. Supabase unchanged.

## V7: 3D handles and own-model deletion
- **Run `supabase_delete_own_models_v7.sql` in SQL Editor** before publishing V7.
- Students can remove **only their own models**, during class editing hours. Other students' models remain protected. The original base city stays locked.
- Build mode includes a **Show / restore 3D movement handles** button, which reattaches the gizmo to a selected model and focuses the camera. Select a model and make sure editing is enabled. Handles hide in Explore mode.
- Database deletion synchronizes to all clients. Uploaded files are retained in private Storage as orphan files until teacher cleanup.
- Publish updated index.html and app.js; style.css and assets unchanged.


## V8: Complete city backup and camera-based placement

- Build mode includes **Export complete city ZIP**. This reads *current* saved
  `city_objects` rows from Supabase, downloads all referenced OBJ files and
  optional MTLs from the private `city-models` bucket, and includes the two
  baseline files currently hosted in `assets/`. It also exports
  `city_layout.json` with the transforms, ids, and original file paths.
- The ZIP is an archive of individual models plus transforms, **not** one
  merged OBJ positioned in city coordinates. Automatic restore/import is
  not provided in V8.
- The exporter works even when class editing is OFF, provided Supabase
  anonymous authentication and existing read permissions are available.
- This export button is **not teacher-only**; authenticated anonymous
  visitors who can access the city can download shared models. A truly
  teacher-only export needs a teacher authentication/role policy.
- Newly imported models are positioned on the city's ground plane near the
  current camera aim. If the view ray points down, it intersects the ground;
  otherwise a forward point is used. The model base is corrected to Y=0
  after scaling. Saved models keep their existing transforms.

### Deploy V8

Replace `index.html` and `app.js` in GitHub and commit. `style.css`, the
existing `assets/`, and Supabase SQL policies are unchanged. ZIP includes
all project files for a full redeployment as well. This build was syntax
checked but has not been tested against your live GitHub/Supabase site.
