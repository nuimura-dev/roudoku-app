const allowedAozoraHosts = new Set(['www.aozora.gr.jp', 'aozora.gr.jp']);

export function aozoraUrl(input: unknown): URL {
  const value = String(input ?? '').trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('青空文庫の図書カードURLを入力してください');
  }
  if (url.protocol !== 'https:' || !allowedAozoraHosts.has(url.hostname) || url.port || url.username || url.password) {
    throw new Error('https://www.aozora.gr.jp/ のURLだけ利用できます');
  }
  if (!url.pathname.startsWith('/cards/')) throw new Error('青空文庫の図書カードURLを入力してください');
  url.hash = '';
  return url;
}

export function isAozoraXhtml(url: URL): boolean {
  return /\/cards\/\d+\/files\/[^/]+\.html$/i.test(url.pathname);
}

export function findAozoraXhtml(cardHtml: string, cardUrl: URL): URL {
  for (const match of cardHtml.matchAll(/href\s*=\s*["']([^"']+\.html(?:[?#][^"']*)?)["']/gi)) {
    const href = match[1];
    if (!href) continue;
    try {
      const candidate = aozoraUrl(new URL(href, cardUrl).href);
      if (isAozoraXhtml(candidate)) return candidate;
    } catch {
      // Cards contain navigation and external links; only a valid files/*.html
      // URL on the Aozora Bunko host is eligible for import.
    }
  }
  throw new Error('この図書カードにXHTML版が見つかりません');
}

function cardText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

export function aozoraFirstPublication(cardHtml: string): string {
  for (const row of cardHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...(row[1] ?? '').matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)];
    if (cells.length >= 2 && /^初出：?$/u.test(cardText(cells[0]?.[1] ?? ''))) {
      return cardText(cells[1]?.[1] ?? '');
    }
  }
  return '';
}
