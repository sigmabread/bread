/**
 * Content-type detection and rewriter selection.
 */

import { isHtmlContentType, isCssContentType, isJsContentType } from './headers.js';
import { rewriteHtml } from './rewriters/html.js';
import { rewriteCss } from './rewriters/css.js';

export function getRewriter(contentType) {
  if (isHtmlContentType(contentType)) return rewriteHtml;
  if (isCssContentType(contentType)) return rewriteCss;
  return null;
}

export function shouldRewrite(contentType) {
  return getRewriter(contentType) != null;
}
