// GET /api/video-status-opensource?video_id=...
// Polls the open-source Modal backend for the status of a job started via
// /api/generate-video-opensource. Maps Modal's { status, video_url, duration }
// straight onto the same contract api/video-status.js already returns for
// HeyGen — status is one of processing | completed | failed either way, so
// no extra mapping logic is needed on the frontend polling loop.
//
// Requires MODAL_STATUS_URL and MODAL_SHARED_SECRET (same secret as
// generate-video-opensource.js). Absent config -> 501 { code: 'NOT_CONFIGURED' }
// (cascade-eligible); any other failure is a real error and is surfaced as-is.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const statusUrl = process.env.MODAL_STATUS_URL;
  const sharedSecret = process.env.MODAL_SHARED_SECRET;
  if (!statusUrl || !sharedSecret) {
    res.status(501).json({ error: 'Modal backend not configured', code: 'NOT_CONFIGURED' });
    return;
  }

  const videoId = req.query.video_id;
  if (!videoId) { res.status(400).json({ error: 'Missing "video_id" query param' }); return; }

  try {
    const url = statusUrl + (statusUrl.includes('?') ? '&' : '?') + 'job_id=' + encodeURIComponent(videoId);
    const modalRes = await fetch(url, { headers: { 'X-Rmint-Secret': sharedSecret } });
    const data = await modalRes.json().catch(() => ({}));

    if (!modalRes.ok) {
      const message = data.detail || data.error || `Modal request failed (${modalRes.status})`;
      res.status(modalRes.status >= 400 ? modalRes.status : 502).json({ error: message });
      return;
    }

    res.status(200).json({
      status: data.status,
      video_url: data.video_url || null,
      duration: data.duration || null,
      error: data.error || null
    });
  } catch (err) {
    res.status(502).json({ error: 'Could not reach Modal backend: ' + err.message });
  }
}
