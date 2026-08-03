# Wiring up the free, open-source video backend (Modal + MuseTalk + Piper)

This is the **free alternative** to `HEYGEN_SETUP.md` — same feature (step videos in Create Guide), different backend. It's tried **first** in the cascade; HeyGen is the second tier; the local simulation is the last-resort fallback. See `RMINT_DATA_FLOW.md`/the code comments in `rmint_lowfi_sync_wireframe_prototype (2).html` for exactly how the cascade decides which tier to use.

> **Read this before you start.** Unlike HeyGen (paste 3 env vars, done), this is a **real ML deployment**: a separate Python repo, a Modal account, and your own licensed avatar video. Budget this as its own project, not an afternoon add-on. See the companion repo's README for the full deploy walkthrough — this doc covers the RMINT-side half (the two Vercel proxy functions + the frontend cascade already built).

## What's already built (nothing to do here)

- `api/generate-video-opensource.js` / `api/video-status-opensource.js` — Vercel proxy functions that forward to your deployed Modal endpoints, reshaping Modal's response onto the exact same `{video_id}` / `{status, video_url, duration}` contract the HeyGen tier already uses.
- The frontend's video-generation cascade (`rmint_lowfi_sync_wireframe_prototype (2).html`, search for `VIDEO_PROVIDERS`) tries this tier first, then HeyGen, then the mock simulation — automatically, no UI toggle needed. Ready cards show an **"Open Source"**, **"HeyGen"**, or **"Simulated"** badge depending on which tier actually produced that video.
- A tier that isn't configured yet (missing env vars) is silently skipped in favor of the next one. A tier that **is** configured but genuinely fails (bad secret, Modal error, timeout) surfaces as a real red "Generation failed" card — it does **not** get masked by quietly falling through to the next tier.

## Step 1 — Deploy the Modal service

That's a separate repo: **[dj-web3/rmint-video-modal](https://github.com/dj-web3/rmint-video-modal)**. Follow its README fully first:
1. Sign up for Modal, install + authenticate the CLI (`pip install modal && modal setup` — this needs you at a browser, can't be automated).
2. Supply your own licensed/consented avatar video at `assets/chef_avatar_loop.mp4` (see that repo's `assets/README.md` — this is a hard requirement, not optional. We can't legally bundle a stock photo/video of a person for you).
3. Create the shared secret: `modal secret create rmint-shared-secret RMINT_SHARED_SECRET=<random-string>` (generate the random string with `openssl rand -hex 32`).
4. `modal deploy app.py` — first deploy takes several minutes (builds an image with MuseTalk + its model weights baked in).
5. Test the three resulting endpoints standalone with curl (exact commands in that repo's README) **before** wiring up Vercel — confirms the ML pipeline itself works before adding another layer on top.

## Step 2 — Point Vercel at it

On the `simple-html-rmint` Vercel project (Project Settings → Environment Variables), add:

| Name | Value |
|---|---|
| `MODAL_GENERATE_URL` | `https://<your-workspace>--rmint-video-modal-web.modal.run/generate` |
| `MODAL_STATUS_URL` | `https://<your-workspace>--rmint-video-modal-web.modal.run/status` |
| `MODAL_SHARED_SECRET` | the same random string from Step 1.3 |

Redeploy (or just wait for the next deploy) so the functions pick up the new env vars.

## Step 3 — Test it

1. Open the app, go to **▣ Create Guide**.
2. Click **🎬 Generate Step Videos**.
3. Cards should go processing → ready with an **"Open Source"** badge and a real playable `<video>`.

**Expect the very first render after Modal has been idle to be slow** — 60-120+ seconds is normal (cold GPU container boot + MuseTalk model load). A render shortly after may land on a still-warm container and be much faster. The frontend already polls for up to 5 minutes before giving up, so this shouldn't time out under normal cold-start conditions — if it does, something's actually wrong (check Modal's logs).

## Troubleshooting

| What you see | What it means | Fix |
|---|---|---|
| Ready cards show **"HeyGen"** badge instead of "Open Source" (and HeyGen is configured) | The Modal tier returned a cascade-eligible signal (not deployed, or `NOT_CONFIGURED`) and the cascade correctly fell through to HeyGen | Check `MODAL_GENERATE_URL`/`MODAL_STATUS_URL`/`MODAL_SHARED_SECRET` are set on Vercel; curl the Modal endpoints directly (Step 1.5) to confirm they work standalone |
| Ready cards show **"Simulated"** badge | Neither Modal nor HeyGen is reachable/configured | Expected if you haven't deployed either backend yet — this is the graceful fallback, not a bug |
| Red **"Generation failed"** card, tooltip mentions Modal/a 401/a MuseTalk error | Modal **is** configured and reachable, but the render itself failed | Hover the card for the exact error. A 401 means the shared secret doesn't match between Vercel's env var and the Modal secret. Anything else — check `modal app logs rmint-video-modal` for the real Python traceback |
| Deploy of `app.py` fails at the `add_local_file` step | You haven't added `assets/chef_avatar_loop.mp4` in the Modal repo yet | See that repo's `assets/README.md` |

## Cost & quality expectations

- Modal's Starter plan gives **$30/month free compute credit, auto-renewing** — comfortably covers realistic usage for a project at RMINT's scale.
- Quality is lower than HeyGen's commercial avatars: MuseTalk lip-syncs a fixed reference video with no independent head motion/emotion. It will look more static.
- Cold starts are the cost of staying free — don't "fix" them by keeping a GPU container warm 24/7 (that alone can cost hundreds of dollars a month and defeats the entire point of this tier).
