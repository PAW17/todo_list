/**
 * Cloudflare Worker — Bing News RSS proxy
 * Usage : GET https://your-worker.workers.dev?q=Accenture
 *
 * SAP : combine Bing + newsroom officiel news.sap.com
 * Accenture, Airbus : Bing uniquement
 */

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return reply(null, 204);

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    if (!q) return reply(JSON.stringify({ error: 'missing ?q=' }), 400);

    const UA  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const key = q.toLowerCase().split(/\s+/)[0];

    const promises = [
      // Bing News RSS (toujours)
      fetch(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=RSS&sortby=Date`,
            { headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, */*' } })
        .then(r => r.text()).then(parseRss).catch(() => [])
    ];

    // SAP : ajouter le newsroom officiel (RSS accessible depuis Cloudflare)
    if (key === 'sap') {
      promises.push(
        fetch('https://news.sap.com/feed/', { headers: { 'User-Agent': UA } })
          .then(r => r.text()).then(parseRss).catch(() => [])
      );
    }

    const results = await Promise.all(promises);

    // Merge + déduplication par titre
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

    // Tri du plus récent au plus ancien
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
