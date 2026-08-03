// POST /api/generate-video-opensource
// Body: { script: string }
// Proxies to the open-source Modal backend (Piper TTS + MuseTalk lip-sync,
// see https://github.com/dj-web3/rmint-video-modal). Reshapes Modal's
// { job_id } response into { video_id } so the frontend's polling logic is
// identical across providers (see rmint_lowfi_sync_wireframe_prototype's
// modalGenerateLive / heygenGenerateLive, which share the same shape).
//
// Requires these environment variables on the Vercel project:
//   MODAL_GENERATE_URL  — e.g. https://<workspace>--rmint-video-modal-web.modal.run/generate
//   MODAL_SHARED_SECRET — the same random string registered via
//                         `modal secret create rmint-shared-secret RMINT_SHARED_SECRET=...`
//
// If these aren't set yet, this returns HTTP 501 with { code: 'NOT_CONFIGURED' }
// — a DELIBERATE, distinguishable signal (not a generic 500) so the frontend
// cascade can tell "this tier isn't set up yet, try the next one" apart from
// "this tier is configured but genuinely broken", which must surface as a
// real, visible error instead of silently falling through.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const generateUrl = process.env.MODAL_GENERATE_URL;
  const sharedSecret = process.env.MODAL_SHARED_SECRET;
  if (!generateUrl || !sharedSecret) {
    res.status(501).json({ error: 'Modal backend not configured', code: 'NOT_CONFIGURED' });
    return;
  }

  const { script } = req.body || {};
  if (!script || typeof script !== 'string') { res.status(400).json({ error: 'Missing "script" in request body' }); return; }

  try {
    const modalRes = await fetch(generateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Rmint-Secret': sharedSecret },
      body: JSON.stringify({ script })
    });

    const data = await modalRes.json().catch(() => ({}));

    if (!modalRes.ok) {
      const message = data.detail || data.error || `Modal request failed (${modalRes.status})`;
      res.status(modalRes.status >= 400 ? modalRes.status : 502).json({ error: message });
      return;
    }

    const jobId = data.job_id;
    if (!jobId) { res.status(502).json({ error: 'Modal response did not include a job_id' }); return; }

    // Reshaped to match HeyGen's { video_id } field name — see file header.
    res.status(200).json({ video_id: jobId });
  } catch (err) {
    res.status(502).json({ error: 'Could not reach Modal backend: ' + err.message });
  }
}
