/**
 * Response handling: CORS, header filtering, security stripping.
 * Applied to every proxy response before sending to client.
 */

import { filterResponseHeaders } from './headers.js';

const STRIP_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'x-content-type-options', // optional: allow proxy to set
  // Node's fetch may transparently decode upstream compression; forwarding these
  // headers can cause browser decoding errors (ERR_CONTENT_DECODING_FAILED).
  'content-encoding',
  'content-length',
]);

/**
 * Headers we always set on the proxy response (CORS, etc.).
 * @param {import('http').IncomingMessage} req - Original client request (for Origin)
 */
export function getProxyResponseHeaders(req) {
  const origin = req.headers.origin || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Expose-Headers': '*',
  };
}

/**
 * Filter and sanitize upstream response headers for forwarding.
 * Removes hop-by-hop and strips headers that block embedding.
 * @param {Record<string, string>} upstreamHeaders - From fetch response
 * @returns {Record<string, string>}
 */
export function sanitizeUpstreamHeaders(upstreamHeaders) {
  const filtered = filterResponseHeaders(upstreamHeaders);
  const out = {};
  for (const [k, v] of Object.entries(filtered)) {
    const lower = k.toLowerCase();
    if (STRIP_HEADERS.has(lower)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Rewrite Location header to point to proxy path (for redirects).
 * @param {string} location - Value from upstream
 * @param {string} targetUrl - Current request URL (for resolving relative)
 * @param {string} proxyBase - e.g. https://example.com
 * @param {function(string): string} encodeUrl - Returns proxy path for full URL (e.g. /go/...)
 * @returns {string|undefined} New location or undefined to leave as-is
 */
export function rewriteRedirectLocation(location, targetUrl, proxyBase, encodeUrl) {
  if (!location || typeof location !== 'string') return undefined;
  try {
    const abs = new URL(location.trim(), targetUrl).href;
    const path = encodeUrl(abs);
    return path ? proxyBase + path : undefined;
  } catch {
    return undefined;
  }
}
