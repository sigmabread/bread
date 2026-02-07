/**
 * Encode/decode URLs for proxy: target URL <-> proxy path.
 */

import config from '../config/index.js';

const PROXY_PATH = config.PROXY_PATH;

/** Returns path for proxied URL: /go/<encoded>. Use as: proxyBase + encodeUrl(url) where proxyBase is origin (e.g. http://localhost:3000). */
export function encodeUrl(targetUrl) {
  try {
    return PROXY_PATH + '/' + encodeURIComponent(targetUrl);
  } catch {
    return PROXY_PATH + '/';
  }
}

export function decodeUrl(encoded) {
  try {
    const raw = decodeURIComponent(encoded);
    if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
      return 'https://' + raw;
    }
    return raw;
  } catch {
    return null;
  }
}

export function getProxyBase(req) {
  const proto = req.headers['x-forwarded-proto'] || (req.connection?.encrypted ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

export function rewriteUrlToProxy(absoluteUrl, proxyBase) {
  try {
    const u = new URL(absoluteUrl);
    const target = u.href;
    const path = encodeUrl(target);
    return proxyBase + path;
  } catch {
    return absoluteUrl;
  }
}
