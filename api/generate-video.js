// POST /api/generate-video
// Body: { script: string }
// Starts a HeyGen avatar video render and returns its video_id.
//
// Requires these environment variables to be set on the Vercel project
// (Project Settings → Environment Variables — never commit them):
//   HEYGEN_API_KEY     — from HeyGen App → Settings → API
//   HEYGEN_AVATAR_ID    — from GET https://api.heygen.com/v2/avatars (or the Avatars page in HeyGen)
//   HEYGEN_VOICE_ID     — from GET https://api.heygen.com/v2/voices (or the Voices page in HeyGen)
//
// HeyGen API reference: https://developers.heygen.com/docs/quick-start
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = process.env.HEYGEN_API_KEY;
  const avatarId = process.env.HEYGEN_AVATAR_ID;
  const voiceId = process.env.HEYGEN_VOICE_ID;
  if (!apiKey) { res.status(500).json({ error: 'HEYGEN_API_KEY is not configured on the server' }); return; }
  if (!avatarId || !voiceId) { res.status(500).json({ error: 'HEYGEN_AVATAR_ID / HEYGEN_VOICE_ID are not configured on the server' }); return; }

  const { script } = req.body || {};
  if (!script || typeof script !== 'string') { res.status(400).json({ error: 'Missing "script" in request body' }); return; }

  try {
    const heygenRes = await fetch('https://api.heygen.com/v2/video/generate', {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_inputs: [{
          character: { type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' },
          voice: { type: 'text', input_text: script, voice_id: voiceId },
          background: { type: 'color', value: '#FAF9F5' } // matches the app's --ivory background
        }],
        dimension: { width: 720, height: 1280 } // portrait, fits the Guide card thumbnail
      })
    });

    const data = await heygenRes.json().catch(() => ({}));

    if (!heygenRes.ok || data.error) {
      const message = (data.error && data.error.message) || data.message || `HeyGen request failed (${heygenRes.status})`;
      res.status(heygenRes.status && heygenRes.status >= 400 ? heygenRes.status : 502).json({ error: message });
      return;
    }

    const videoId = data.data && data.data.video_id;
    if (!videoId) { res.status(502).json({ error: 'HeyGen response did not include a video_id' }); return; }

    res.status(200).json({ video_id: videoId });
  } catch (err) {
    res.status(502).json({ error: 'Could not reach HeyGen: ' + err.message });
  }
}
