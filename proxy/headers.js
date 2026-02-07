/**
 * Request/response header processing for proxy.
 */

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade',
]);

const SENSITIVE_REQUEST_HEADERS = new Set([
  'host', 'origin', 'referer', 'cookie', 'authorization',
  'cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'x-real-ip',
]);

export function filterResponseHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (v !== undefined && v !== null) out[k] = Array.isArray(v) ? v[v.length - 1] : v;
  }
  return out;
}

export function buildProxyRequestHeaders(targetUrl, incomingReq) {
  const u = new URL(targetUrl);
  const headers = { ...incomingReq.headers };
  delete headers.host;
  delete headers.connection;
  delete headers['content-length'];
  headers.host = u.host;
  headers.origin = u.origin;
  headers.referer = u.origin + '/';
  return headers;
}

export function isTextContentType(contentType) {
  if (!contentType) return false;
  const ct = contentType.split(';')[0].trim().toLowerCase();
  return (
    ct.startsWith('text/') ||
    ct.includes('javascript') ||
    ct.includes('json') ||
    ct.includes('xml') ||
    ct === 'application/x-www-form-urlencoded'
  );
}

export function isHtmlContentType(contentType) {
  if (!contentType) return false;
  const ct = contentType.split(';')[0].trim().toLowerCase();
  return ct === 'text/html' || ct === 'application/xhtml+xml';
}

export function isCssContentType(contentType) {
  if (!contentType) return false;
  const ct = contentType.split(';')[0].trim().toLowerCase();
  return ct === 'text/css';
}

export function isJsContentType(contentType) {
  if (!contentType) return false;
  const ct = contentType.split(';')[0].trim().toLowerCase();
  return (
    ct.includes('javascript') ||
    ct === 'application/json' && false
  );
}
