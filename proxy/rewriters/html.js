/**
 * HTML rewriter: rewrite href, src, action, form, link, script, etc. to proxy URLs.
 */

import { encodeUrl } from '../url-encoder.js';

const ATTRS = [
  'href', 'src', 'action', 'data', 'cite', 'formaction', 'manifest',
  'poster', 'background', 'content', 'url', 'xlink:href',
];

const TAG_ATTR_MAP = {
  a: ['href'],
  link: ['href'],
  script: ['src'],
  img: ['src', 'data-src', 'data-lazy-src'],
  iframe: ['src'],
  form: ['action'],
  video: ['src', 'poster'],
  audio: ['src'],
  source: ['src'],
  track: ['src'],
  embed: ['src'],
  object: ['data'],
  area: ['href'],
  base: ['href'],
};

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

function rewriteAttrValue(value, baseUrl, proxyBase) {
  const abs = absoluteUrl(baseUrl, value);
  if (abs === value && !value.startsWith('http')) return value;
  try {
    return proxyBase + encodeUrl(abs);
  } catch {
    return value;
  }
}

function rewriteMetaRefresh(content) {
  return content.replace(
    /<meta\s+http-equiv\s*=\s*["']?refresh["']?\s+content\s*=\s*["']?\d+\s*;\s*url\s*=\s*([^"'\s>]+)["']?/gi,
    (match, url) => {
      const u = url.trim();
      if (!u.startsWith('http')) return match;
      return match.replace(url, '___PROXY_BASE___' + encodeUrl(u));
    }
  );
}

function rewriteInlineStyles(html, baseUrl, proxyBase) {
  return html.replace(
    /style\s*=\s*["']([^"']*)["']/gi,
    (m, style) => {
      const rewritten = style.replace(
        /url\s*\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi,
        (_, url) => {
          const abs = absoluteUrl(baseUrl, url);
          if (abs === url && !url.startsWith('http')) return m;
          return 'url(\'' + proxyBase + encodeUrl(abs) + '\')';
        }
      );
      return 'style="' + rewritten.replace(/"/g, '&quot;') + '"';
    }
  );
}

export function rewriteHtml(html, baseUrl, proxyBase) {
  if (!html || typeof html !== 'string') return html;
  let out = html;

  out = rewriteMetaRefresh(out);
  out = out.replace(/___PROXY_BASE___/g, proxyBase);

  for (const [tag, attrs] of Object.entries(TAG_ATTR_MAP)) {
    for (const attr of attrs) {
      const re = new RegExp(
        `<${tag}[^>]+${attr}\\s*=\\s*["']([^"']*)["']`,
        'gi'
      );
      out = out.replace(re, (match, val) => {
        const newVal = rewriteAttrValue(val, baseUrl, proxyBase);
        return match.replace(val, newVal.replace(/&/g, '&amp;').replace(/"/g, '&quot;'));
      });
    }
  }

  out = out.replace(
    /<base\s+([^>]*href\s*=\s*["'])([^"']*)(["'][^>]*)>/gi,
    (_, before, href, after) => {
      const newHref = proxyBase + encodeUrl(absoluteUrl(baseUrl, href));
      return '<base ' + before + newHref + after + '>';
    }
  );

  out = rewriteInlineStyles(out, baseUrl, proxyBase);

  out = out.replace(
    /(href|src|action)\s*=\s*["']([^"']+)["']/gi,
    (match, attr, val) => {
      const newVal = rewriteAttrValue(val, baseUrl, proxyBase);
      if (newVal === val) return match;
      return attr + '="' + newVal.replace(/"/g, '&quot;') + '"';
    }
  );

  return out;
}
