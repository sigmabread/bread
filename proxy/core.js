/**
 * Core proxy handler: parse request → fetch upstream → process response (headers, redirect, body rewrite or stream).
 * Delegates to request, fetch-opts, response, stream, and content-types/rewriters for a modular pipeline.
 */

import config from '../config/index.js';
import { encodeUrl, getProxyBase } from './url-encoder.js';
import { parseProxyPath, validateTargetUrl, readRequestBody } from './request.js';
import { buildFetchOptions } from './fetch-opts.js';
import {
  getProxyResponseHeaders,
  sanitizeUpstreamHeaders,
  rewriteRedirectLocation,
} from './response.js';
import { streamToArrayBuffer, bufferToUtf8, pipeStreamToResponse } from './stream.js';
import { getRewriter, shouldRewrite } from './content-types.js';

const PROXY_PATH = config.PROXY_PATH;
const TIMEOUT = config.PROXY_TIMEOUT_MS;

/**
 * Handle incoming proxy request: GET /go/<encoded-url> or POST with body.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export async function handleProxyRequest(req, res) {
  const path = req.path || req.url || '';
  const parsed = parseProxyPath(path);
  if (parsed.error) {
    res.statusCode = 400;
    return res.end(parsed.error);
  }

  const { targetUrl } = parsed;
  const validation = validateTargetUrl(targetUrl);
  if (!validation.ok) {
    res.statusCode = 400;
    return res.end(validation.error || 'Invalid target URL');
  }

  const proxyBase = getProxyBase(req);
  const method = (req.method || 'GET').toUpperCase();

  let body = Buffer.alloc(0);
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    try {
      body = await readRequestBody(req);
    } catch (e) {
      res.statusCode = 400;
      return res.end('Error reading request body');
    }
  }

  const fetchOptions = buildFetchOptions(targetUrl, req, body.length ? body : undefined, TIMEOUT);

  let fetchRes;
  try {
    fetchRes = await fetch(targetUrl, fetchOptions);
  } catch (e) {
    console.error('Proxy fetch error:', e.message);
    res.statusCode = 502;
    return res.end('Gateway error: ' + (e.message || 'Unknown'));
  }

  const contentType = fetchRes.headers.get('content-type') || '';
  const outHeaders = sanitizeUpstreamHeaders(
    Object.fromEntries(fetchRes.headers.entries())
  );

  if (fetchRes.status >= 300 && fetchRes.status < 400) {
    const loc = fetchRes.headers.get('location');
    const newLoc = rewriteRedirectLocation(loc, targetUrl, proxyBase, encodeUrl);
    if (newLoc) outHeaders['location'] = newLoc;
  }

  const proxyHeaders = getProxyResponseHeaders(req);
  res.statusCode = fetchRes.status;
  for (const [k, v] of Object.entries(proxyHeaders)) {
    res.setHeader(k, v);
  }
  for (const [k, v] of Object.entries(outHeaders)) {
    res.setHeader(k, v);
  }

  if (!shouldRewrite(contentType)) {
    if (!fetchRes.body) return res.end();
    pipeStreamToResponse(fetchRes.body, res);
    return;
  }

  const buffer = await streamToArrayBuffer(fetchRes.body);
  const text = bufferToUtf8(buffer);
  const rewriter = getRewriter(contentType);
  const baseUrl = new URL(targetUrl).origin + '/';
  const rewritten = rewriter(text, baseUrl, proxyBase);

  const rewrittenBuffer = Buffer.from(rewritten, 'utf8');
  res.setHeader('Content-Length', rewrittenBuffer.length);
  res.end(rewrittenBuffer);
}
