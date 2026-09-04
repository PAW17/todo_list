/**
 * Cloudflare Worker — Google News RSS proxy
 * Déploiement : https://workers.cloudflare.com (gratuit, pas de carte)
 *
 * Usage : GET https://your-worker.workers.dev?q=Accenture
 */

export default {
  async fetch(request) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return reply(null, 204);
    }

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    if (!q) return reply(JSON.stringify({ error: 'missing ?q=' }), 400);

    const rssUrl =
      `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en&gl=US&ceid=US:en`;

    try {
      const res = await fetch(rssUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' }
      });
      const xml   = await res.text();
      const items = parseRss(xml).slice(0, 8);
      return reply(JSON.stringify({ items }), 200);
    } catch (e) {
      return reply(JSON.stringify({ error: e.message }), 500);
    }
  }
};

/* ── XML helpers ── */
function parseRss(xml) {
  const items = [];
  const rx = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = rx.exec(xml)) !== null) {
    const s      = m[1];
    const title  = cdata(s, 'title')  || tag(s, 'title');
    const link   = tag(s, 'link')     || tag(s, 'guid');
    const date   = tag(s, 'pubDate');
    const source = cdata(s, 'source') || tag(s, 'source');
    if (title) items.push({ title, link, date, source });
  }
  return items;
}

function cdata(s, t) {
  const m = new RegExp(`<${t}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${t}>`).exec(s);
  return m?.[1]?.trim() ?? '';
}

function tag(s, t) {
  const m = new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`).exec(s);
  return m?.[1]?.trim() ?? '';
}

function reply(body, status) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods':'GET, OPTIONS',
      'Cache-Control':               'public, max-age=1800'   // 30 min
    }
  });
}
