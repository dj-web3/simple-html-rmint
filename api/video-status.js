// GET /api/video-status?video_id=...
// Polls HeyGen for the status of a video started via /api/generate-video.
// Returns { status, video_url, duration, error } where status is one of
// HeyGen's values: pending | waiting | processing | completed | failed.
//
// Requires HEYGEN_API_KEY (same env var as generate-video.js).
//
// NOTE: HeyGen's video_url is a temporary link that expires ~7 days after
// generation. For anything you want to keep, download it and re-host it
// (e.g. in object storage) — don't rely on the HeyGen URL long-term.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'HEYGEN_API_KEY is not configured on the server' }); return; }

  const videoId = req.query.video_id;
  if (!videoId) { res.status(400).json({ error: 'Missing "video_id" query param' }); return; }

  try {
    const heygenRes = await fetch(
      `https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
      { headers: { 'X-Api-Key': apiKey } }
    );
    const data = await heygenRes.json().catch(() => ({}));

    if (!heygenRes.ok || data.error) {
      const message = (data.error && data.error.message) || data.message || `HeyGen request failed (${heygenRes.status})`;
      res.status(heygenRes.status && heygenRes.status >= 400 ? heygenRes.status : 502).json({ error: message });
      return;
    }

    const d = data.data || {};
    res.status(200).json({
      status: d.status,
      video_url: d.video_url || null,
      duration: d.duration || null,
      error: d.error || null
    });
  } catch (err) {
    res.status(502).json({ error: 'Could not reach HeyGen: ' + err.message });
  }
}
