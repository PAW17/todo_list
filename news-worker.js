/**
 * Cloudflare Worker — News proxy
 * Bing News RSS + optional direct RSS feed + optional JSON index (Accenture)
 *
 * Usage:
 *   GET ?q=Accenture
 *   GET ?q=SAP&rss=https://news.sap.com/feed/
 *   GET ?q=Accenture&json=https://newsroom.accenture.com/query-index.json&base=https://newsroom.accenture.com
 */

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return reply(null, 204);

    const { searchParams } = new URL(request.url);
    const q    = searchParams.get('q');
    const rss  = searchParams.get('rss');   // direct RSS feed URL
    const json = searchParams.get('json');  // JSON index URL (Accenture format)
    const base = searchParams.get('base');  // base URL to prepend to article paths

    if (!q) return reply(JSON.stringify({ error: 'missing ?q=' }), 400);

    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    let items = [];

    // 1. Bing News RSS
    try {
      const bingUrl = `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=RSS&sortby=Date`;
      const bingRes = await fetch(bingUrl, { headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, */*' } });
      items = parseRss(await bingRes.text());
    } catch (_) {}

    // 2. Optional direct RSS feed (e.g. SAP newsroom)
    if (rss) {
      try {
        const rssRes = await fetch(rss, { headers: { 'User-Agent': UA } });
        const extra  = parseRss(await rssRes.text());
        const seen   = new Set(items.map(i => i.title));
        for (const item of extra) {
          if (!seen.has(item.title)) { items.push(item); seen.add(item.title); }
        }
      } catch (_) {}
    }

    // 3. Optional JSON index (Accenture query-index.json)
    if (json && base) {
      try {
        const cutoff30 = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
        const jsonRes  = await fetch(json, { headers: { 'User-Agent': UA } });
        const data     = await jsonRes.json();
        const seen     = new Set(items.map(i => i.title));
        for (const article of (data.data || [])) {
          const ts = parseInt(article.publisheddateinseconds || '0', 10);
          if (ts < cutoff30) break; // data is sorted newest first, stop when too old
          const item = {
            title : article.title || '',
            link  : base + article.path,
            date  : ts ? new Date(ts * 1000).toUTCString() : '',
            source: 'Accenture Newsroom'
          };
          if (item.title && !seen.has(item.title)) { items.push(item); seen.add(item.title); }
        }
      } catch (_) {}
    }

    // Sort by date descending
    items.sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    });

    return reply(JSON.stringify({ items: items.slice(0, 20) }), 200);
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
