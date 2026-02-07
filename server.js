/**
 * Bread Proxy - Local server entry point.
 * For Vercel, the app is mounted at api/index.js.
 */

import http from 'http';
import app, { bareServer } from './app.js';
import config from './config/index.js';
const server = http.createServer((req, res) => {
  try {
    if (req.url && req.url.startsWith('/bare/')) {
      // Handle Bare before Express to avoid Node/undici "body locked" issues.
      bareServer.routeRequest(req, res);
      return;
    }
  } catch (_) {}
  app(req, res);
});

server.on('upgrade', (req, socket, head) => {
  try {
    if (req.url && req.url.startsWith('/bare/')) {
      bareServer.routeUpgrade(req, socket, head);
      return;
    }
  } catch (_) {}
  socket.destroy();
});

server.listen(config.PORT, () => {
  console.log(`Bread Proxy listening on http://localhost:${config.PORT}`);
  console.log(`  Main: /  |  Keys: /keys-1  |  Updates: /updates  |  Proxy: /sj/<url>  |  Bare: /bare/`);
});
