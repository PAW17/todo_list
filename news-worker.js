/**
 * Cloudflare Worker — Bing News RSS proxy + optional direct RSS feed
 * Usage : GET https://your-worker.workers.dev?q=Accenture
 *         GET https://your-worker.workers.dev?q=SAP&rss=https://news.sap.com/feed/
 */

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return reply(null, 204);

    const { searchParams } = new URL(request.url);
    const q   = searchParams.get('q');
    const rss = searchParams.get('rss'); // optional direct RSS feed URL
    if (!q) return reply(JSON.stringify({ error: 'missing ?q=' }), 400);

    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    try {
      // Always fetch Bing News
      const bingUrl = `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=RSS&sortby=Date`;
      const bingRes = await fetch(bingUrl, { headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, */*' } });
      const bingXml = await bingRes.text();
      let items = parseRss(bingXml);

      // Optionally merge with a direct RSS feed
      if (rss) {
        try {
          const rssRes = await fetch(rss, { headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, */*' } });
          const rssXml = await rssRes.text();
          const rssItems = parseRss(rssXml);
          // Merge and deduplicate by title
          const seen = new Set(items.map(i => i.title));
          for (const item of rssItems) {
            if (!seen.has(item.title)) { items.push(item); seen.add(item.title); }
          }
        } catch (_) { /* RSS feed failed — continue with Bing only */ }
      }

      // Sort by date descending, most recent first
      items.sort((a, b) => {
        const da = a.date ? new Date(a.date).getTime() : 0;
        const db = b.date ? new Date(b.date).getTime() : 0;
        return db - da;
      });

      return reply(JSON.stringify({ items: items.slice(0, 20) }), 200);
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
      'Cache-Control':               'public, max-age=1800'
    }
  });
}
