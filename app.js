/**
 * Bread Proxy - Express app (used by server.js and Vercel serverless).
 */

import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { createBareServer } from '@tomphttp/bare-server-node';

import config from './config/index.js';
import * as keysStorage from './storage/keys.js';
import { registerStatic } from './routes/index.js';
import routes from './routes/index.js';
import { requireDeviceKey } from './middleware/auth.js';
import { handleProxyRequest } from './proxy/core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const require = createRequire(import.meta.url);

let scramjetDistPath = null;
let bareMuxDistPath = null;
let bareModuleDistPath = null;
let bareClientDistPath = null;
let uvDistPath = null;
try {
  const scramjetPkg = require('@mercuryworkshop/scramjet');
  scramjetDistPath = scramjetPkg && scramjetPkg.scramjetPath ? scramjetPkg.scramjetPath : null;
} catch (_) {}
try {
  const bareMuxEntry = require.resolve('@mercuryworkshop/bare-mux');
  bareMuxDistPath = path.dirname(bareMuxEntry);
} catch (_) {}
try {
  const bareModulePkg = require('@mercuryworkshop/bare-as-module3');
  bareModuleDistPath = bareModulePkg && bareModulePkg.bareModulePath ? bareModulePkg.bareModulePath : null;
} catch (_) {}
try {
  const bareClientEntry = require.resolve('@tomphttp/bare-client');
  bareClientDistPath = path.dirname(bareClientEntry);
} catch (_) {}
if (!bareClientDistPath) {
  const fallbackPath = path.join(__dirname, 'node_modules', '@tomphttp', 'bare-client', 'dist');
  if (fs.existsSync(fallbackPath)) bareClientDistPath = fallbackPath;
}
try {
  const uvEntry = require.resolve('@titaniumnetwork-dev/ultraviolet/dist/uv.bundle.js');
  uvDistPath = path.dirname(uvEntry);
} catch (_) {}
if (!uvDistPath) {
  const fallbackPath = path.join(__dirname, 'node_modules', '@titaniumnetwork-dev', 'ultraviolet', 'dist');
  if (fs.existsSync(fallbackPath)) uvDistPath = fallbackPath;
}

keysStorage.setDataFilePath(config.KEYS_DATA_FILE);
await keysStorage.load();

const app = express();
app.locals.proxyEngine = uvDistPath ? 'ultraviolet' : scramjetDistPath ? 'scramjet' : 'none';
app.locals.barePath = '/bare/';
app.locals.scramjetPrefix = '/sj/';
app.locals.scramjetAssets = '/scramjet/';
app.locals.bareMuxAssets = '/baremux/';
app.locals.bareModuleAssets = '/baremod/';
app.locals.bareClientAssets = '/bareclient/';
app.locals.uvPrefix = '/service/';
app.locals.uvAssets = '/uv/';
app.locals.scramjetAvailable = !!scramjetDistPath;
app.locals.uvAvailable = !!uvDistPath;

function normalizeBareUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return null;
  return trimmed.endsWith('/') ? trimmed : trimmed + '/';
}

function getConfiguredBareUrls() {
  const fromList = String(config.BARE_URLS || '').trim();
  const fromSingle = String(config.BARE_URL || '').trim();
  const raw = fromList ? fromList : fromSingle;
  if (!raw) return [app.locals.barePath];
  const urls = raw
    .split(',')
    .map((u) => normalizeBareUrl(u))
    .filter(Boolean);
  return urls.length ? urls : [app.locals.barePath];
}

app.locals.bareUrls = getConfiguredBareUrls();

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Default very high for local dev; UV pages can generate hundreds of keep-alive requests quickly,
// especially during failures/retries.
const bareMaxConnectionsPerIP = parsePositiveInt(process.env.BARE_MAX_CONNECTIONS_PER_IP, 25000);
const bareWindowDuration = parsePositiveInt(process.env.BARE_CONNECTION_WINDOW_DURATION, 60);
const bareBlockDuration = parsePositiveInt(process.env.BARE_CONNECTION_BLOCK_DURATION, 1);

export const bareServer = createBareServer('/bare/', {
  logErrors: false,
  // bare-server-node defaults to 10 keep-alive requests/min per IP, which is too low for modern pages.
  connectionLimiter: {
    maxConnectionsPerIP: bareMaxConnectionsPerIP,
    windowDuration: bareWindowDuration,
    blockDuration: bareBlockDuration,
  },
});

// NOTE: Bare is best handled in `server.js` *before* Express sees the request.
// We keep this middleware for serverless environments that only invoke the Express app.
app.use('/bare/', (req, res) => {
  req.url = req.originalUrl || req.url;
  bareServer.routeRequest(req, res);
});

app.set('trust proxy', 1);
app.use(cookieParser(config.SESSION_SECRET));
app.use(
  session({
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
  })
);

if (scramjetDistPath) {
  app.use(
    app.locals.scramjetAssets,
    express.static(scramjetDistPath, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('.js') || filePath.endsWith('.map') || filePath.endsWith('.wasm')) {
          res.setHeader('Cache-Control', 'no-store');
        }
      },
    })
  );
}
if (bareMuxDistPath) {
  app.use(
    app.locals.bareMuxAssets,
    express.static(bareMuxDistPath, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('.js') || filePath.endsWith('.map')) res.setHeader('Cache-Control', 'no-store');
      },
    })
  );
}
if (bareModuleDistPath) {
  app.use(
    app.locals.bareModuleAssets,
    express.static(bareModuleDistPath, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('.mjs') || filePath.endsWith('.js') || filePath.endsWith('.map')) {
          res.setHeader('Cache-Control', 'no-store');
        }
      },
    })
  );
}
if (bareClientDistPath) {
  app.use(
    app.locals.bareClientAssets,
    express.static(bareClientDistPath, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('.js') || filePath.endsWith('.map') || filePath.endsWith('.cjs')) {
          res.setHeader('Cache-Control', 'no-store');
        }
      },
    })
  );
}

app.use(config.PROXY_PATH, requireDeviceKey, (req, res, next) => {
  handleProxyRequest(req, res).catch(next);
});

// Body parsing must come after `/bare/` and the streaming proxy route, otherwise it disturbs the request stream.
app.use(express.json({ limit: config.MAX_REQUEST_SIZE }));
app.use(express.urlencoded({ extended: true, limit: config.MAX_REQUEST_SIZE }));

app.use(routes);
registerStatic(app, publicDir);

// Serve Ultraviolet assets after registerStatic so /uv/uv.config.js can be overridden.
if (uvDistPath) {
  app.use(
    app.locals.uvAssets,
    express.static(uvDistPath, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('.js') || filePath.endsWith('.map')) {
          res.setHeader('Cache-Control', 'no-store');
        }
      },
    })
  );

  // Also expose UV assets at the root for compatibility with default configs.
  app.use(
    express.static(uvDistPath, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('.js') || filePath.endsWith('.map')) {
          res.setHeader('Cache-Control', 'no-store');
        }
      },
    })
  );
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Internal Server Error');
});

export default app;
