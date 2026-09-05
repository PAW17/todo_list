/**
 * Cloudflare Worker — News proxy
 * Sources officiales codées dans le Worker selon le mot-clé q.
 * Usage simple : GET ?q=Accenture | ?q=SAP | ?q=Airbus
 */

const OFFICIAL_SOURCES = {
  'accenture': {
    type: 'json-index',
    url : 'https://newsroom.accenture.com/query-index.json',
    base: 'https://newsroom.accenture.com',
    source: 'Accenture Newsroom'
  },
  'sap': {
    type: 'rss',
    url : 'https://news.sap.com/feed/'
  }
  // Airbus : Bing uniquement (pas de source officielle disponible)
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return reply(null, 204);

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    if (!q) return reply(JSON.stringify({ error: 'missing ?q=' }), 400);

    const UA  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const key = q.toLowerCase().split(/\s+/)[0]; // premier mot = clé de recherche
    const official = OFFICIAL_SOURCES[key];

    // Build parallel promises
    const promises = [];

    // 1. Bing News RSS (toujours)
    promises.push(
      fetch(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=RSS&sortby=Date`,
            { headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, */*' } })
        .then(r => r.text()).then(parseRss).catch(() => [])
    );

    // 2. Source officielle si connue
    if (official) {
      if (official.type === 'rss') {
        promises.push(
          fetch(official.url, { headers: { 'User-Agent': UA } })
            .then(r => r.text()).then(parseRss).catch(() => [])
        );
      } else if (official.type === 'json-index') {
        const cutoff = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
        promises.push(
          fetch(official.url, { headers: { 'User-Agent': UA } })
            .then(r => r.json())
            .then(data => {
              const out = [];
              for (const a of (data.data || [])) {
                const ts = parseInt(a.publisheddateinseconds || '0', 10);
                if (ts < cutoff) break;
                if (a.title) out.push({
                  title : a.title,
                  link  : official.base + a.path,
                  date  : new Date(ts * 1000).toUTCString(),
                  source: official.source
                });
              }
              return out;
            }).catch(() => [])
        );
      }
    }

    // Run in parallel
    const results = await Promise.all(promises);

    // Merge + deduplicate
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

    // Sort newest first
    items.sort((a, b) =>
      (b.date ? new Date(b.date).getTime() : 0) -
      (a.date ? new Date(a.date).getTime() : 0)
    );

    return reply(JSON.stringify({ items: items.slice(0, 20) }), 200);
  }
};

function parseRss(xml) {
  const items = [];
  const rx = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = rx.exec(xml)) !== null) {
    const s = m[1];
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
