/**
 * Stream and buffer utilities for proxy response body.
 */

import { Readable } from 'stream';

/**
 * Pipe a Web ReadableStream to Node.js response.
 * @param {ReadableStream} stream - From fetch() response.body
 * @param {import('http').ServerResponse} res
 */
export function pipeStreamToResponse(stream, res) {
  if (!stream) return;
  const nodeStream = Readable.fromWeb(stream);
  nodeStream.pipe(res);
}

/**
 * Consume a ReadableStream into an ArrayBuffer (for rewriting).
 * @param {ReadableStream} stream
 * @returns {Promise<ArrayBuffer>}
 */
export async function streamToArrayBuffer(stream) {
  const chunks = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out.buffer;
}

/**
 * Decode ArrayBuffer to UTF-8 string (with replacement for invalid sequences).
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
export function bufferToUtf8(buffer) {
  return Buffer.from(buffer).toString('utf8');
}