/*
 * Vercel serverless proxy — the production equivalent of proxy_server.py.
 *
 * Forwards /api/* to the Peekaboo REST API with the X-API-Key injected
 * server-side (key lives in the PEEKABOO_API_KEY env var, never in the
 * browser). Successful GETs are cached at Vercel's edge for 5 minutes,
 * same TTL as the local proxy, to stay under the API rate limits.
 */

const API_BASE = 'https://www.aipeekaboo.com/api/v1';

module.exports = async function handler(req, res) {
  const apiKey = process.env.PEEKABOO_API_KEY;
  if (!apiKey) {
    res.status(500).json({ success: false, error: { code: 'NO_KEY', message: 'PEEKABOO_API_KEY env var is not set' } });
    return;
  }

  // req.url is e.g. /api/brands/123/snapshot?time_range=30d — strip the /api prefix
  const sub = req.url.replace(/^\/api/, '');
  const url = API_BASE + sub;

  const init = {
    method: req.method,
    headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' },
  };
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }

  let upstream;
  try {
    upstream = await fetch(url, init);
  } catch (e) {
    res.status(502).json({ success: false, error: { code: 'PROXY_ERROR', message: String(e && e.message || e) } });
    return;
  }

  const body = await upstream.text();
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
  if (req.method === 'GET' && upstream.status === 200) {
    // edge cache: 5 min fresh, serve stale for 10 more while revalidating
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  } else {
    res.setHeader('Cache-Control', 'no-store');
  }
  res.status(upstream.status).send(body);
};
