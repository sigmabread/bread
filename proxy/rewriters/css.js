/**
 * CSS rewriter: rewrite url() and @import to proxy URLs.
 */

import { encodeUrl } from '../url-encoder.js';

function absoluteUrl(baseUrl, value) {
  if (!value || typeof value !== 'string') return value;
  value = value.trim();
  if (/^\s*#|^\s*data:/i.test(value)) return value;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return value;
  }
}

export function rewriteCss(css, baseUrl, proxyBase) {
  if (!css || typeof css !== 'string') return css;

  let out = css;

  out = out.replace(
    /url\s*\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi,
    (match, url) => {
      url = url.trim();
      if (/^\s*#|^\s*data:/i.test(url)) return match;
      const abs = absoluteUrl(baseUrl, url);
      const proxied = proxyBase + encodeUrl(abs);
      return 'url(\'' + proxied.replace(/'/g, "\\'") + '\')';
    }
  );

  out = out.replace(
    /@import\s+(?:url\s*\(\s*)?['"]?([^'")\s;]+)['"]?\s*\)?\s*;?/gi,
    (match, url) => {
      url = url.trim();
      if (url.startsWith('url(')) return match;
      const abs = absoluteUrl(baseUrl, url);
      const proxied = proxyBase + encodeUrl(abs);
      return '@import url(\'' + proxied.replace(/'/g, "\\'") + '\');';
    }
  );

  return out;
}
