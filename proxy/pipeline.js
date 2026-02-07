/**
 * Proxy pipeline: configurable request/response processing stages.
 * Allows plugging in rewriters, validators, and transformers without touching core.
 */

import { shouldRewrite, getRewriter } from './content-types.js';
import { filterResponseHeaders } from './headers.js';

const DEFAULT_STAGES = Object.freeze({
  request: ['validate-url', 'build-fetch-opts'],
  response: ['filter-headers', 'rewrite-redirect', 'rewrite-body', 'stream'],
});

/**
 * Run response through pipeline stages. Used by core for extensibility.
 */
export function runResponsePipeline(stages, context) {
  let current = context.initialResponse;
  for (const name of stages) {
    const stage = context.stages[name];
    if (!stage) continue;
    current = stage(current, context);
    if (current === null || current === undefined) break;
  }
  return current;
}

/**
 * Create a default response pipeline context for the rewriter flow.
 */
export function createResponseContext(fetchResponse, targetUrl, proxyBase, getProxyBase) {
  const contentType = fetchResponse.headers.get('content-type') || '';
  return {
    fetchResponse,
    targetUrl,
    proxyBase,
    getProxyBase,
    contentType,
    outHeaders: filterResponseHeaders(Object.fromEntries(fetchResponse.headers.entries())),
    shouldRewrite: () => shouldRewrite(contentType),
    getRewriter: () => getRewriter(contentType),
  };
}
