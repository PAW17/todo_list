/**
 * Cloudflare Worker — News proxy
 * Bing News RSS + optional direct RSS feed + optional JSON index (Accenture)
 * Sources fetched in PARALLEL for speed.
 */

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return reply(null, 204);

    const { searchParams } = new URL(request.url);
    const q    = searchParams.get('q');
    const rss  = searchParams.get('rss');
    const json = searchParams.get('json');
    const base = searchParams.get('base');

    if (!q) return reply(JSON.stringify({ error: 'missing ?q=' }), 400);

    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    // Build parallel fetch promises
    const fetches = [];

    // 1. Bing News RSS
    fetches.push(
      fetch(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=RSS&sortby=Date`,
            { headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, */*' } })
        .then(r => r.text()).then(xml => parseRss(xml)).catch(() => [])
    );

    // 2. Optional direct RSS feed (SAP newsroom)
    if (rss) {
      fetches.push(
        fetch(rss, { headers: { 'User-Agent': UA } })
          .then(r => r.text()).then(xml => parseRss(xml)).catch(() => [])
      );
    }

    // 3. Optional JSON index (Accenture query-index.json)
    if (json && base) {
      const cutoff30 = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
      fetches.push(
        fetch(json, { headers: { 'User-Agent': UA } })
          .then(r => r.json())
          .then(data => {
            const out = [];
            for (const article of (data.data || [])) {
              const ts = parseInt(article.publisheddateinseconds || '0', 10);
              if (ts < cutoff30) break; // sorted newest first
              if (article.title) out.push({
                title : article.title,
                link  : base + article.path,
                date  : new Date(ts * 1000).toUTCString(),
                source: 'Accenture Newsroom'
              });
            }
            return out;
          }).catch(() => [])
      );
    }

    // Run all in parallel
    const results = await Promise.all(fetches);

    // Merge and deduplicate by title
    const seen  = new Set();
    const items = [];
    for (const batch of results) {
      for (const item of batch) {
        if (item.title && !seen.has(item.title)) {
          items.push(item);
          seen.add(item.title);
        }
      }
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
