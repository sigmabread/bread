/**
 * Build fetch options for upstream request: headers, method, body, redirect, timeout.
 * Centralizes browser-like headers and forwarding of incoming request data.
 */

import { getBrowserLikeHeaders } from './browser-headers.js';

/**
 * @typedef {Object} FetchOptions
 * @property {string} method
 * @property {Record<string, string>} headers
 * @property {Buffer|undefined} [body]
 * @property {RequestRedirect} redirect
 * @property {AbortSignal} signal
 */

/**
 * Build headers for the upstream fetch. Uses browser-like headers by default;
 * forwards Content-Type (and optionally body) for POST/PUT/PATCH.
 * @param {string} targetUrl - Absolute target URL
 * @param {import('http').IncomingMessage} req - Incoming request
 * @param {{ forwardContentType?: boolean }} [opts]
 * @returns {Record<string, string>}
 */
export function buildUpstreamHeaders(targetUrl, req, opts = {}) {
  const headers = getBrowserLikeHeaders(targetUrl);

  const method = (req.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    const ct = req.headers['content-type'];
    if (ct) headers['Content-Type'] = ct;
  }

  return headers;
}

/**
 * Build full fetch options for the upstream request.
 * @param {string} targetUrl
 * @param {import('http').IncomingMessage} req
 * @param {Buffer} [body]
 * @param {number} timeoutMs
 * @returns {FetchOptions}
 */
export function buildFetchOptions(targetUrl, req, body, timeoutMs) {
  const method = (req.method || 'GET').toUpperCase();
  const headers = buildUpstreamHeaders(targetUrl, req);

  const options = {
    method,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  };

  if (body && body.length > 0) {
    options.body = body;
    if (!options.headers['Content-Type']) {
      options.headers['Content-Type'] = 'application/octet-stream';
    }
  }

  return options;
}
