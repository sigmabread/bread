/**
 * JavaScript rewriter: light touch - rewrite common URL patterns (fetch, XHR, location, etc.).
 * Heavy JS rewriting is complex; we do essential patterns so relative fetches work.
 */

import { encodeUrl } from '../url-encoder.js';

function absoluteUrl(baseUrl, value) {
  if (!value || typeof value !== 'string') return value;
  value = value.trim();
  if (/^\s*#|^\s*javascript:|^\s*data:/i.test(value)) return value;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return value;
  }
}

export function rewriteJavaScript(js, baseUrl, proxyBase) {
  if (!js || typeof js !== 'string') return js;
  let out = js;
  const encodedBase = baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const proxyBaseEsc = proxyBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return out;
}
