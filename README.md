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


## V9 — Teacher Mode and uniform scaling
See TEACHER_SETUP.txt and supabase_teacher_mode_v9.sql. Teacher email/password is checked by Supabase Auth; class students remain anonymous. The original baseline remains locked. Uniform scaling is performed with the size field or +/- buttons (no deceptive per-axis gizmo).


## V10: Direct Tinkercad ZIP imports and descriptive filenames

- Upload one `.zip` exported by Tinkercad containing a single OBJ and an optional MTL, **or** select OBJ + MTL together. Nested folders are supported. The ZIP is unpacked in the browser; the OBJ and MTL are stored separately in Supabase.
- Optional **What did you make?** text field: enter a short description such as `Dinosaur`. The stored file names become `dinosaur_<unique-code>.obj` and `.mtl`. The database model ID remains a UUID, and `.mtl` naming tracks the `.obj`.
- With a generic Tinkercad export name such as `tinker.obj` and no description, the default name is `model_<unique-code>`. Automatically identifying the object from the geometry is not implemented.
- Model ZIPs are limited to 25 MB compressed, and the extracted OBJ/MTL files are limited to 20 MB each. A ZIP containing multiple OBJ or MTL files is rejected rather than silently choosing the wrong file.
- No database migrations or Supabase policy changes are needed. Replace `index.html` and `app.js` in GitHub Pages; keep `style.css` and `assets/`.


## V11: Uniform drag scaling

Choose Build -> Scale, then drag left/right directly on any contributed model. All three axes scale together; holding Shift makes the gesture finer. The existing +/- buttons and Uniform size field still work. Release the pointer to save the scale in Supabase. This avoids TransformControls axis handles misbehaving as translation. The locked original city cannot be resized. No SQL changes.


## V12 editing handle fix
- Move/rotate gizmos attach to a separate pivot positioned at the top-center of the selected model's visible bounding box, not its exported OBJ origin.
- Use **Handle clearance above model** to raise the handles without moving the model. Default is 4 world units.
- Rotation handles are restricted to world vertical (Y), matching saved `rotation_y`.
- Uniform scale drag (V11), navigation, and Supabase storage and sync remain unchanged.
- Update GitHub `app.js` and `index.html` only. No database changes.


## V13: Teacher rename + edit even while class editing is OFF
- Run `supabase_teacher_rename_v13.sql` in the Supabase SQL Editor.
- Existing verified teachers can edit/delete contributed structures regardless of `city_settings.editing_enabled`.
- Teacher Mode now has a `Rename selected model` button in Build mode.
- Renames change only the display name in `city_objects.name`, **not** the OBJ or MTL filenames.
- Rename updates propagate to other open browsers via Supabase Realtime.
- The original single-OBJ baseline remains locked.
- Student editing remains restricted to class time.
- Update the root `index.html`, `app.js` and `style.css` on GitHub Pages. Do not replace your city `assets` folder.
