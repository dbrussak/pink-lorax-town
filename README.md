# Pink Lorax Town — City Explorer (prototype)

A browser-based viewer using your original `tinker.obj` + `obj.mtl`, plus a local model placement editor.

## What already works

- Loads your existing colored Tinkercad city automatically.
- Flythrough: W/A/S/D; mouse look after **Enter flythrough**; Space rises, Shift descends, Esc releases mouse.
- **Overview** and **Reset view** controls.
- **Build** mode imports a student's `.obj` and optional `.mtl` files together.
- Select an added object, then move, rotate or scale it using the handles. The original city is locked.
- Autosaves uploaded object data and transforms to **this browser's IndexedDB**. A separate button exports layout transforms as JSON.

## Important limitations

This is **version 1: a working local prototype, not yet a shared collaborative app**. Other students will not see changes until a database and shared model storage service (e.g. Supabase) are connected.

- Uploads are stored in the browser that uploaded them; clearing site data removes them.
- No authentication, per-student permissions, live synchronization, edit locks or rollback are implemented yet.
- Textures using external image files (`map_Kd`) are not supported by this prototype; material *colors* in MTL (`Kd`) are supported.
- Collision with buildings is intentionally disabled to make flying easy.
- The model has ~231,000 faces, so initial OBJ loading may take some seconds on slower Chromebooks.

## Publish using your GitHub account

1. Create a public GitHub repository, e.g. `pink-lorax-town`.
2. Upload the *contents* of this folder (not the folder itself), keeping `index.html`, `app.js`, `style.css` and `assets/` at the repository root.
3. In your repository, go to **Settings → Pages → Build and deployment → Deploy from a branch**. Select `main` and `/(root)` and save.
4. Visit `https://YOUR-USERNAME.github.io/pink-lorax-town/` after Pages deploys.
5. Open the link on a Chromebook in Chrome. No extension required.

GitHub Pages serves static files only. A local double-click on `index.html` may fail because browsers usually block module imports and local OBJ fetches. To test locally, run a server, for example `python -m http.server 8000` from this directory and visit `http://localhost:8000`.

**Note:** This prototype imports Three.js modules from jsDelivr and Google Fonts from Google. The school network needs to allow `cdn.jsdelivr.net`. If the CDN is blocked, the Three.js dependencies can be bundled locally in a later build.

## Next: near-real-time collaboration

Add Supabase Storage for student files, database records for positions/rotations/scales, and Realtime subscriptions to update models when another student saves. Use authenticated student identities with server-side Row Level Security and Storage policies. Add editing locks / change history for conflicts. Do not make public unrestricted write policies or embed a Supabase service-role key in this website.

OBJ files exported by Tinkercad commonly have Z as up. The application rotates OBJ models to the browser's Y-up coordinate system automatically.
