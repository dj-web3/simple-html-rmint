# RMINT — Project Status

Living handoff doc. Read this first in any new session before touching video-gen or deployment work. Keep it updated as things change — don't let it go stale.

---

## Repo map

| Repo | Purpose | Notes |
|---|---|---|
| [`dj-web3/RMINT-Creator-AI`](https://github.com/dj-web3/RMINT-Creator-AI) | Original repo | Superseded by `simple-html-rmint` for active work |
| [`dj-web3/simple-html-rmint`](https://github.com/dj-web3/simple-html-rmint) | **Primary app** — the single-file HTML prototype + Vercel serverless functions | Local checkout: `/Users/theuxdj/Documents/RMINT iOS` |
| [`dj-web3/rmint-video-modal`](https://github.com/dj-web3/rmint-video-modal) | Standalone Modal service: Piper TTS + MuseTalk lip-sync (free video-gen backend) | Local checkout: `/Users/theuxdj/Documents/rmint-video-modal` (sibling dir) |

## Branch map (`simple-html-rmint`)

| Branch | Contains |
|---|---|
| `main` | Base app only — **no video-gen integration at all** (no `api/` folder) |
| `Discover` | Discovery + Pairing screens (lattice cards, taste graph) |
| `Haygen-integration` | Adds HeyGen-only video-gen (`api/generate-video.js`, `api/video-status.js`) |
| `opensource-video-alt` | **Current active branch.** Branched from `Haygen-integration`. Adds Modal+MuseTalk as a free tier tried *before* HeyGen. This is what's live in production. |

None of the video-gen branches are merged into `main` yet.

## Live links

- **Production (Modal + HeyGen cascade):** https://simple-html-rmint.vercel.app/rmint_lowfi_sync_wireframe_prototype%20(2).html
- **Preview (HeyGen-only, `Haygen-integration` branch):** https://simple-html-rmint-cdiovl1o0-dmukerji99-2753s-projects.vercel.app/... — auth-walled (Vercel SSO), needs `dmukerji99-2753` login in-browser. Preview retention: ~30 days on Hobby plan, but protected longer as "latest preview for an active branch."
- Vercel project: `dmukerji99-2753s-projects/simple-html-rmint`. Vercel CLI is authenticated on this machine already (`vercel whoami` → `dmukerji99-2753`).
- Modal app: `rmint-video-modal`, deployed, endpoint base `https://dmukerji99--rmint-video-modal-web.modal.run`.

## Video-gen architecture (on `opensource-video-alt`)

Multi-provider cascade in `rmint_lowfi_sync_wireframe_prototype (2).html` (search `VIDEO_PROVIDERS`): tries **Modal (free) → HeyGen (paid) → local mock simulation**, in that order. Each tier is cascade-skipped on a `NO_BACKEND`/`NOT_CONFIGURED` signal; any *other* failure from a reachable/configured tier surfaces as a real error — never silently masked. Full design rationale in `RMINT_DATA_FLOW.md` and inline code comments.

- `api/generate-video.js` + `api/video-status.js` → HeyGen
- `api/generate-video-opensource.js` + `api/video-status-opensource.js` → Modal
- Setup docs: `HEYGEN_SETUP.md`, `MODAL_SETUP.md`

**Confirmed working end-to-end** (Aug 2026): real HeyGen video generated and played; real MuseTalk lip-synced mp4 generated and played (442KB, verified valid ISO-media file) via the deployed Modal service.

## Known gotchas (hard-won, don't rediscover these)

- **`rmint-video-modal` repo has no unrelated scaffold issue** (unlike `simple-html-rmint`, which has an old Vite/React app in its root — `vercel.json` sets `framework: null` + empty build/install commands, and `.vercelignore` excludes the unrelated 189MB `FigmaMakecreator/` dir, to keep Vercel deploys scoped correctly).
- **MuseTalk's `download_weights.sh` has two silent-failure bugs**, both patched via `sed` in `rmint-video-modal/app.py`'s image build:
  1. It runs `pip install -U "huggingface_hub[cli]"`, which grabs the true latest release — a version that has **deprecated the `huggingface-cli` command** in favor of `hf`. Every weight download in the script silently no-ops (prints a deprecation warning, downloads nothing) while the script still reports "✅ All weights downloaded successfully." Fix: strip that line, let it use the already-installed compatible `huggingface_hub` version.
  2. It sets `export HF_ENDPOINT=https://hf-mirror.com` (China mirror) — also stripped.
  - **Lesson:** don't trust a script's own "success" message — verify actual file existence in the built image before trusting a build.
- **`torch` version must match `mmcv`'s pre-built wheel availability**, not be chosen arbitrarily. MuseTalk needs the OpenMMLab stack (`mmcv`/`mmdet`/`mmpose`, installed via `mim`, NOT in `requirements.txt` — only documented in their README prose). Using `torch==2.1.2` caused `mmcv` to fall back to a from-source C++ compile that failed; matching MuseTalk's own README-recommended `torch==2.0.1` fixed it (matching `mmcv==2.0.1`'s actual pre-built wheel coverage).
- **`modal deploy` needs `fastapi` importable in the *local* Python env**, not just baked into the remote Image — the web routes are defined at module import time.
- **The current avatar video is a placeholder**: MuseTalk's own bundled demo clip (`data/video/yongen.mp4`), used because sourcing a real licensed person's video wasn't something Claude could do unilaterally (rights/consent issue). Swap in a real one via `assets/chef_avatar_loop.mp4` before any real/public use — see `rmint-video-modal/assets/README.md`.
- **A Modal API token was accidentally exposed in a chat transcript** (~Aug 3, 2026) due to a `sed` redaction bug (macOS `sed` doesn't support `\s` in extended regex the way GNU sed does — the redaction silently no-op'd and printed the raw secret). It was rotated by the user. **Lesson: never trust an untested redaction command against a real secret — verify the pattern against dummy data first, or use Python instead of `sed`/regex tools with unverified portability.**
- **Vercel preview deployments are SSO-auth-walled by default** — production URLs are not. If you need a shareable-without-login link, promote to production or use the always-public production alias.

## Pending / unfinished

- **Higgsfield integration** — was mid-research when context ran low. Findings so far: Higgsfield is primarily marketed as a cinematic/character-consistency creative suite (Soul ID, Audio, Lipsync Studio), not a standalone avatar tool like HeyGen — but it does have a "Lipsync Studio" component that might fit. **Not yet confirmed:** whether Lipsync Studio is actually exposed via their public REST API (`docs.higgsfield.ai`) vs. web-UI-only. Next step if resuming: verify their actual API schema (same rigor as was applied to HeyGen/MuseTalk — don't guess), then decide branch structure (likely: new branch off `opensource-video-alt` adding it as a third cascade tier, OR an isolated branch mirroring how `Haygen-integration` started, per user preference — ask before assuming).
- Consider merging `opensource-video-alt` → `main` now that Modal+HeyGen are both confirmed working (was offered to user, not yet actioned).
- `rmint-video-modal`'s Volume (`rmint-video-store`) has no cleanup/retention policy — rendered mp4s accumulate indefinitely.
- No CORS/rate-limiting hardening on the Vercel proxy functions beyond the shared-secret check.

## Working conventions established this session

- **Always commit + push after edits** (standing user instruction from early in the project).
- Give brief status updates during long iterative debugging chains — don't go silent across many tool calls without checking in.
- Verify claims (API schemas, library license terms, deploy success) against real sources/live checks rather than asserting from memory — this was applied consistently and caught several real bugs early.
