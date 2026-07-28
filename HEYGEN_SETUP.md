# Wiring up the real HeyGen backend

The app's code is done and pushed to the `Haygen-integration` branch. What's left needs **your** accounts and credentials — I can't create those for you. This doc is the exact click-by-click path.

## What's already built (nothing to do here)

- `api/generate-video.js` — serverless function, calls HeyGen `POST /v2/video/generate`
- `api/video-status.js` — serverless function, polls HeyGen `GET /v1/video_status.get`
- `vercel.json` — tells Vercel to skip any build step and serve this repo's files as-is (static file + the two functions), sidestepping the unrelated old Vite/React scaffold that also lives in this repo. Vercel auto-detects the two files in `api/` as serverless functions with zero extra config.
- The frontend (`rmint_lowfi_sync_wireframe_prototype (2).html`) already calls these two endpoints, polls until the render finishes, and:
  - shows a real `<video>` player once HeyGen returns an mp4 URL
  - shows a **red "Generation failed — click to retry"** card on any real error (bad key, HeyGen error, timeout) — errors are never hidden
  - **automatically falls back to the local simulation** if no backend is deployed (e.g. viewed on plain GitHub Pages), so the branch keeps demoing even before you finish the steps below

## Step 1 — Get a HeyGen API key

1. Sign up at [heygen.com](https://heygen.com) (a free trial includes some credits — video generation isn't free after that, see Costs below).
2. Go to **Settings → API** in the HeyGen app.
3. Copy your API key. **Don't paste it in chat or commit it anywhere** — it goes straight into Vercel's dashboard in Step 3.

## Step 2 — Pick an avatar and a voice

You need an `avatar_id` and a `voice_id`. Easiest path: HeyGen's own **Avatars** and **Voices** pages in the app UI show the ID for each option you can browse visually.

If you'd rather query them directly, run this in a terminal once you have your key:

```bash
# list avatars — find one you like, copy its "avatar_id"
curl -s https://api.heygen.com/v2/avatars -H "X-Api-Key: YOUR_KEY_HERE" | head -c 2000

# list voices — find one you like, copy its "voice_id"
curl -s https://api.heygen.com/v2/voices -H "X-Api-Key: YOUR_KEY_HERE" | head -c 2000
```

Keep the `avatar_id` and `voice_id` values handy for Step 3.

**Nice-to-have, not required now:** since RMINT has 4 chef roles (SOUS/STATION/JUNIOR/TRAINEE), you could eventually pick a different avatar per role. For now, one avatar + one voice for all steps is simplest — that's what the current code does (`HEYGEN_AVATAR_ID` / `HEYGEN_VOICE_ID` are single values).

## Step 3 — Deploy to Vercel

1. Go to [vercel.com](https://vercel.com), sign up/log in (GitHub login is easiest).
2. **Add New → Project**, import `dj-web3/simple-html-rmint`.
3. In the import screen, set **Branch** to `Haygen-integration` (Vercel defaults to your repo's default branch — change it in the project's Git settings if it doesn't ask upfront).
4. **Framework Preset:** leave as "Other" (the included `vercel.json` handles the rest).
5. Before deploying, open **Environment Variables** and add:
   | Name | Value |
   |---|---|
   | `HEYGEN_API_KEY` | your key from Step 1 |
   | `HEYGEN_AVATAR_ID` | your avatar ID from Step 2 |
   | `HEYGEN_VOICE_ID` | your voice ID from Step 2 |
6. Click **Deploy**.

Vercel will give you a URL like `https://simple-html-rmint.vercel.app`. That's now your live app **with the real HeyGen backend attached** — same file, same UI, no code changes needed.

The root URL itself isn't wired to a specific file (no rewrite configured), so open the app at:
```
https://simple-html-rmint.vercel.app/rmint_lowfi_sync_wireframe_prototype%20(2).html
```
(the `%20` is just the space in the filename, URL-encoded — your browser handles this automatically if you type the space).

## Step 4 — Test it

1. Open your Vercel URL (the direct file path above).
2. Go to **▣ Create Guide**.
3. Click **🎬 Generate Step Videos**.
4. Each card should go **processing → ready**, and clicking a ready card should play a **real HeyGen mp4**, not the simulated avatar. If it falls back to the simulated avatar instead, the backend isn't being reached — see Troubleshooting.

## Troubleshooting

| What you see | What it means | Fix |
|---|---|---|
| Cards go ready but still show the **simulated grey avatar** (not a real video) | The app couldn't reach `/api/generate-video` (got a 404/405, or a non-JSON response) and silently fell back to simulation | Confirm you're on the **Vercel URL**, not GitHub Pages. Check the Vercel project's **Functions** tab to confirm `generate-video` and `video-status` deployed. |
| Card shows **red "Generation failed"** | The backend *was* reached, but HeyGen (or the function) returned a real error. Hover the card for the tooltip message | Open browser dev tools → Network tab → check the `/api/generate-video` response body for the exact HeyGen error (commonly: bad/missing API key, invalid avatar/voice ID, out of credits) |
| Vercel deploy fails at build | Shouldn't happen — `vercel.json` sets `buildCommand`/`installCommand` to empty so nothing builds | Check the Vercel deploy log; make sure `vercel.json` made it into the deployment (it's tracked in the branch) |
| `500 HEYGEN_API_KEY is not configured` | Env var missing or misspelled | Recheck Vercel → Project Settings → Environment Variables, redeploy after adding |

## Costs & limits (read before generating a lot of videos)

- Each HeyGen video render **consumes credits** on your plan. The app **caches per step** (keyed by a hash of that step's 6 parameters) — editing a step's title/time/etc. is what triggers a regeneration; unrelated changes don't.
- HeyGen's returned `video_url` is a **temporary link — it expires around 7 days** after generation. This prototype just links straight to that URL. For anything you want to keep long-term, the backend would need to download the mp4 and re-host it somewhere permanent (S3, Vercel Blob, etc.) — not built yet, flag it if you want it next.
- A render isn't instant — expect anywhere from ~30 seconds to a couple of minutes per clip depending on script length and HeyGen's queue. The 5-minute client-side timeout in `heygenGenerateLive` is generous headroom for that.

## If you want to go further later

- **Per-chef avatars/voices:** swap the single `HEYGEN_AVATAR_ID`/`HEYGEN_VOICE_ID` env vars for a small lookup table keyed by chef role, in `api/generate-video.js`.
- **Webhooks instead of polling:** HeyGen supports a callback URL so the function gets pinged when a render finishes, instead of the frontend polling every 3 seconds — cheaper and faster, more setup.
- **Persistent storage:** re-host the mp4 before the 7-day link expires.
