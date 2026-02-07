/**
 * Browser-like request headers for upstream fetch.
 * Makes the proxy request look like a normal browser to avoid 403 and blocking.
 */

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function getBrowserLikeHeaders(targetUrl) {
  const u = new URL(targetUrl);
  const origin = u.origin;
  return {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    // Avoid upstream compression to prevent client-side decoding errors when proxying
    // (Node fetch may transparently decode while headers are forwarded).
    'Accept-Encoding': 'identity',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': CHROME_UA,
    'Host': u.host,
    'Origin': origin,
    'Referer': origin + '/',
  };
}
