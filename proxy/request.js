/**
 * Proxy request parsing and validation.
 * Extracts target URL and method from incoming request; validates and normalizes.
 */

import { decodeUrl } from './url-encoder.js';

/**
 * @typedef {Object} ParsedProxyRequest
 * @property {string} targetUrl - Absolute target URL (http(s))
 * @property {string} method - HTTP method (uppercase)
 * @property {string} [encodedPath] - Raw encoded path segment
 */

/**
 * Parse the proxy path to get the target URL.
 * Path format: /go/<encoded-full-url> or /go/<encoded-url>
 * @param {string} path - req.path when mounted at PROXY_PATH
 * @returns {{ targetUrl: string, encodedPath: string } | { error: string }}
 */
export function parseProxyPath(path) {
  const trimmed = (path || '').replace(/^\/+/, '');
  const segment = trimmed.split('/')[0];
  if (!segment) {
    return { error: 'Missing target URL' };
  }

  const targetUrl = decodeUrl(segment);
  if (!targetUrl) {
    return { error: 'Invalid target URL encoding' };
  }
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    return { error: 'Invalid target URL scheme' };
  }

  return { targetUrl, encodedPath: segment };
}

/**
 * Validate URL is allowed (no file:, etc.) and optionally blocklist.
 * @param {string} url
 * @returns {{ ok: true } | { error: string }}
 */
export function validateTargetUrl(url) {
  try {
    const u = new URL(url);
    const proto = u.protocol.toLowerCase();
    if (proto !== 'http:' && proto !== 'https:') {
      return { error: 'Scheme not allowed' };
    }
    return { ok: true };
  } catch {
    return { error: 'Invalid URL' };
  }
}

/**
 * Read request body stream into a buffer (for POST/PUT/PATCH).
 * @param {import('stream').Readable} stream
 * @returns {Promise<Buffer>}
 */
export async function readRequestBody(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
