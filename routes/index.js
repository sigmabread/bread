/**
 * Main app routes: serve static pages and mount API/proxy.
 */

import express, { Router } from 'express';
import { join } from 'path';
import keysRouter from './keys.js';

const router = Router();

let egressIpCache = { ip: null, checkedAt: 0, expiresAt: 0, error: null };
let egressIpInFlight = null;

let proxyEgressCache = { ip: null, checkedAt: 0, expiresAt: 0, error: null, bareUrl: null };
let proxyEgressInFlight = null;

function egressIpSnapshot() {
  const now = Date.now();
  return {
    ip: egressIpCache.ip,
    checkedAt: egressIpCache.checkedAt,
    stale: egressIpCache.expiresAt <= now,
    error: egressIpCache.error,
  };
}

function proxyEgressSnapshot() {
  const now = Date.now();
  return {
    ip: proxyEgressCache.ip,
    checkedAt: proxyEgressCache.checkedAt,
    stale: proxyEgressCache.expiresAt <= now,
    error: proxyEgressCache.error,
    bareUrl: proxyEgressCache.bareUrl,
  };
}

async function refreshEgressIp() {
  const now = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const resp = await fetch('https://api.ipify.org?format=json', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'user-agent': 'BREAD/1.0 (+ipify)' },
    });
    const data = await resp.json().catch(() => null);
    const ip = data && typeof data.ip === 'string' ? data.ip.trim() : null;
    if (!resp.ok || !ip) {
      const msg = `egress_ip_fetch_failed status=${resp.status}`;
      egressIpCache = { ip: egressIpCache.ip, checkedAt: now, expiresAt: now + 60_000, error: msg };
      return;
    }
    egressIpCache = { ip, checkedAt: now, expiresAt: now + 10 * 60_000, error: null };
  } catch (e) {
    egressIpCache = {
      ip: egressIpCache.ip,
      checkedAt: now,
      expiresAt: now + 60_000,
      error: String((e && (e.message || e)) || 'egress_ip_fetch_error'),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshProxyEgressIp(bareUrl) {
  const now = Date.now();
  const normalizedBareUrl = bareUrl && typeof bareUrl === 'string' ? bareUrl.trim() : null;
  if (!normalizedBareUrl) {
    proxyEgressCache = { ...proxyEgressCache, checkedAt: now, expiresAt: now + 30_000, error: 'proxy_egress_bare_url_missing' };
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const { createBareClient } = await import('@tomphttp/bare-client');
    const client = await createBareClient(new URL(normalizedBareUrl));

    const resp = await client
      .fetch('https://api.ipify.org?format=json', { cache: 'no-store', signal: controller.signal })
      .finally(() => clearTimeout(timeout));

    const data = await resp.json().catch(() => null);
    const ip = data && typeof data.ip === 'string' ? data.ip.trim() : null;
    if (!resp.ok || !ip) {
      const msg = `proxy_egress_fetch_failed status=${resp.status}`;
      proxyEgressCache = { ...proxyEgressCache, checkedAt: now, expiresAt: now + 60_000, error: msg, bareUrl: normalizedBareUrl };
      return;
    }

    proxyEgressCache = { ip, checkedAt: now, expiresAt: now + 10 * 60_000, error: null, bareUrl: normalizedBareUrl };
  } catch (e) {
    proxyEgressCache = {
      ...proxyEgressCache,
      checkedAt: now,
      expiresAt: now + 60_000,
      error: String((e && (e.message || e)) || 'proxy_egress_fetch_error'),
      bareUrl: normalizedBareUrl,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getEgressIpMaybeRefresh() {
  const snap = egressIpSnapshot();
  if (snap.stale && !egressIpInFlight) {
    egressIpInFlight = refreshEgressIp().finally(() => {
      egressIpInFlight = null;
    });
  }
  return snap;
}

function getProxyEgressIpMaybeRefresh(bareUrl) {
  const current = proxyEgressSnapshot();
  if (bareUrl && bareUrl !== proxyEgressCache.bareUrl) {
    proxyEgressCache.expiresAt = 0;
    proxyEgressCache.bareUrl = bareUrl;
  }
  if (current.stale && !proxyEgressInFlight) {
    proxyEgressInFlight = refreshProxyEgressIp(bareUrl).finally(() => {
      proxyEgressInFlight = null;
    });
  }
  return proxyEgressSnapshot();
}

function resolveBareUrls(req) {
  const base = `${req.protocol}://${req.get('host')}`;
  const raw = req.app?.locals?.bareUrls;
  const list = Array.isArray(raw) && raw.length ? raw : [String(req.app?.locals?.barePath || '/bare/')];
  const out = [];
  for (const item of list) {
    const trimmed = String(item || '').trim();
    if (!trimmed) continue;
    const url = /^https?:\/\//i.test(trimmed) ? trimmed : new URL(trimmed, base).toString();
    out.push(url.endsWith('/') ? url : url + '/');
  }
  return out.length ? out : [new URL(String(req.app?.locals?.barePath || '/bare/'), base).toString()];
}

router.use('/api/keys', keysRouter);

router.get('/api/status', (req, res) => {
  const serverEgress = getEgressIpMaybeRefresh();
  const bareUrls = resolveBareUrls(req);
  const proxyEgress = getProxyEgressIpMaybeRefresh(bareUrls[0]);
  const engine = String(req.app?.locals?.proxyEngine || 'none');

  const scramjetEnabled = !!req.app?.locals?.scramjetAvailable;
  const scramjet = scramjetEnabled
    ? {
        enabled: true,
        prefix: String(req.app?.locals?.scramjetPrefix || '/sj/'),
        assets: String(req.app?.locals?.scramjetAssets || '/scramjet/'),
        baremux: String(req.app?.locals?.bareMuxAssets || '/baremux/'),
        baremod: String(req.app?.locals?.bareModuleAssets || '/baremod/'),
        bareclient: String(req.app?.locals?.bareClientAssets || '/bareclient/'),
      }
    : { enabled: false };

  const uvEnabled = !!req.app?.locals?.uvAvailable;
  const uvPrefix = String(req.app?.locals?.uvPrefix || '/service/');
  const uvAssets = String(req.app?.locals?.uvAssets || '/uv/');
  const ultraviolet = uvEnabled
    ? {
        enabled: true,
        prefix: uvPrefix,
        assets: uvAssets,
        config: uvAssets.endsWith('/') ? uvAssets + 'uv.config.js' : uvAssets + '/uv.config.js',
      }
    : { enabled: false };

  res.json({
    ok: true,
    serverTime: Date.now(),
    engine,
    scramjet,
    ultraviolet,
    client: {
      ip: req.ip,
      ips: req.ips,
    },
    bare: {
      path: String(req.app?.locals?.barePath || '/bare/'),
      urls: bareUrls,
      note: 'Proxy egress IP is determined by the Bare server you use (local by default).',
    },
    serverEgress,
    proxyEgress,
    // Back-compat: older UI looked for `egress`.
    egress: proxyEgress,
  });
});

router.get('/api/selftest', async (req, res) => {
  // Minimal server-side proof that Bare is functional, without exposing an open proxy endpoint.
  // This performs a single GET to https://example.com via the local Bare server.
  try {
    const bareUrls = resolveBareUrls(req);
    const bareUrl = new URL(bareUrls[0]);

    const { createBareClient } = await import('@tomphttp/bare-client');
    const client = await createBareClient(bareUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const resp = await client
      .fetch('https://example.com/', { cache: 'no-store', signal: controller.signal })
      .finally(() => clearTimeout(timeout));

    const contentType = resp.headers.get('content-type') || '';
    const text = await resp.text().catch(() => '');
    const m = text.match(/<title>\s*([^<]+)\s*<\/title>/i);
    const title = m ? m[1] : null;

    res.json({
      ok: true,
      bareUrl: bareUrl.toString(),
      fetch: {
        status: resp.status,
        finalURL: resp.finalURL,
        contentType,
        title,
        bodyLength: text.length,
      },
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: String((e && (e.stack || e.message || e)) || 'Unknown error'),
    });
  }
});

export default router;

export function registerStatic(app, publicDir) {
  // Service workers should never be cached. Otherwise users get stuck on old SW/client bundles
  // and end up needing to "clear site data" to recover.
  app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(join(publicDir, 'sw.js'));
  });

  // One-click recovery page: clears caches + service workers when users are stuck on a legacy proxy build.
  // Intentionally does NOT clear "storage" so history + device id survive.
  app.get('/reset', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Clear-Site-Data', '"cache", "executionContexts"');
    res.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Resetting BREAD…</title>
    <style>
      :root{color-scheme:dark;background:#120f0c;color:#f5ecd8;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
      body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}
      .card{max-width:760px;width:100%;background:rgba(42,34,24,.72);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:22px;box-shadow:0 16px 48px rgba(0,0,0,.45)}
      h1{margin:0 0 8px;font-size:18px}
      p{margin:0;color:#b8a88a;line-height:1.6}
      .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
      a{display:inline-flex;align-items:center;justify-content:center;padding:10px 12px;border-radius:12px;text-decoration:none;font-weight:900}
      a.primary{background:#c89b3c;color:#120f0c;border:1px solid rgba(0,0,0,.18)}
      a.secondary{background:transparent;color:#f5ecd8;border:1px solid rgba(255,255,255,.12)}
      code{color:#f5ecd8;background:rgba(0,0,0,.25);padding:2px 6px;border-radius:8px}
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Resetting BREAD…</h1>
      <p>This clears cached assets + service workers so the Scramjet proxy can start cleanly. It should not delete your history or device id.</p>
      <p style="margin-top:10px">If you're running on <code>localhost</code>, you may still see your normal IP unless you configure a remote Bare server.</p>
      <div class="row">
        <a class="primary" href="/">Go Home</a>
        <a class="secondary" href="#" onclick="location.reload(); return false;">Run again</a>
      </div>
      <script>setTimeout(()=>location.replace('/'), 700);</script>
    </main>
  </body>
</html>`);
  });

  // Scramjet runtime config (must be at a stable, absolute path for injected pages + the service worker).
  app.get('/scramjet.config.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');

    const prefix = String(req.app?.locals?.scramjetPrefix || '/sj/');
    const assets = String(req.app?.locals?.scramjetAssets || '/scramjet/');

    res.end(
      [
        '(()=>{',
        '  self.__scramjet$config={',
        `    prefix:${JSON.stringify(prefix)},`,
        '    codec:self.__scramjet$codecs.plain,',
        '    config:"/scramjet.config.js",',
        `    bundle:${JSON.stringify(assets + 'scramjet.bundle.js')},`,
        `    worker:${JSON.stringify(assets + 'scramjet.worker.js')},`,
        `    client:${JSON.stringify(assets + 'scramjet.client.js')},`,
        `    codecs:${JSON.stringify(assets + 'scramjet.codecs.js')},`,
        '  };',
        '})();',
        '',
      ].join('\n')
    );
  });

  // Ultraviolet runtime config (served under /uv/ to avoid collisions).
  function sendUvConfig(req, res) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');

    const prefix = String(req.app?.locals?.uvPrefix || '/service/');
    const assets = String(req.app?.locals?.uvAssets || '/uv/');
    const base = assets.endsWith('/') ? assets : assets + '/';
    const inject = [
      {
        host: '.*',
        injectTo: 'head',
        html:
          '<script>(function(){if(typeof window.__tcfapi!==\"function\"){window.__tcfapi=function(command,version,callback){if(typeof callback!==\"function\")return;var base={tcString:\"\",gdprApplies:false,cmpStatus:\"loaded\",eventStatus:\"tcloaded\",listenerId:0};switch(String(command||\"\").toLowerCase()){case\"ping\":callback({gdprApplies:false,cmpLoaded:true,cmpStatus:\"loaded\",apiVersion:version||2},true);break;case\"gettcdata\":case\"gettcstring\":callback(base,true);break;default:callback(base,true);break}};window.__tcfapiLocator=window.__tcfapiLocator||{};}})();</script>',
      },
    ];

    res.end(
      [
        '(()=>{',
        '  self.__uv$config={',
        `    prefix:${JSON.stringify(prefix)},`,
        '    encodeUrl:Ultraviolet.codec.xor.encode,',
        '    decodeUrl:Ultraviolet.codec.xor.decode,',
        `    handler:${JSON.stringify(base + 'uv.handler.js')},`,
        `    client:${JSON.stringify(base + 'uv.client.js')},`,
        `    bundle:${JSON.stringify(base + 'uv.bundle.js')},`,
        `    config:${JSON.stringify(base + 'uv.config.js')},`,
        `    sw:${JSON.stringify(base + 'uv.sw.js')},`,
        `    inject:${JSON.stringify(inject)},`,
        '  };',
        '})();',
        '',
      ].join('\n')
    );
  }

  app.get('/uv/uv.config.js', (req, res) => sendUvConfig(req, res));
  app.get('/uv.config.js', (req, res) => sendUvConfig(req, res));

  // If a user lands directly on a Scramjet URL (e.g. pasted into the address bar) before the SW is installed,
  // the proxy won't work. Serve a tiny bootstrap page that installs the SW then resumes navigation.
  app.get('/sj/*', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    const target = req.originalUrl || req.url || '/';
    const bareUrls = resolveBareUrls(req);
    res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Starting proxy...</title>
  <style>
    :root{color-scheme:dark;background:#120f0c;color:#f5ecd8;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}
    .card{max-width:720px;width:100%;background:rgba(42,34,24,.72);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:22px;box-shadow:0 16px 48px rgba(0,0,0,.45)}
    h1{margin:0 0 8px;font-size:18px}
    p{margin:0;color:#b8a88a;line-height:1.6}
    a{color:#c49a3a}
  </style>
</head>
<body>
  <main class="card">
    <h1>Starting the proxy...</h1>
    <p>Installing the service worker required for Scramjet. If this page doesn't continue, open <a href="/">Home</a>.</p>
  </main>
  <script>
    (async function () {
      if (!('serviceWorker' in navigator)) return location.replace('/');
      try { await navigator.serviceWorker.register('/sw.js', { scope: '/' }); } catch (e) {}
      try { await navigator.serviceWorker.ready; } catch (e) {}
      try {
        const mux = await import('/baremux/index.mjs').catch(() => null);
        const BareMuxConnection = mux && mux.BareMuxConnection;
        if (BareMuxConnection) {
          const connection = new BareMuxConnection('/baremux/worker.js');
          const bareUrls = ${JSON.stringify(bareUrls)};
          await connection.setTransport('/baremod/index.mjs', bareUrls);
        }
      } catch (e) {}
      if (navigator.serviceWorker.controller) location.replace(${JSON.stringify(target)});
      else location.reload();
    })();
  </script>
</body>
</html>`);
  });

  // If a user lands directly on a UV URL (e.g. pasted into the address bar) before the SW is installed,
  // the proxy won't work. Serve a tiny bootstrap page that installs the SW then resumes navigation.
  app.get('/service/*', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    const target = req.originalUrl || req.url || '/';
    const bareUrls = resolveBareUrls(req);
    res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Starting proxy...</title>
  <style>
    :root{color-scheme:dark;background:#120f0c;color:#f5ecd8;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}
    .card{max-width:720px;width:100%;background:rgba(42,34,24,.72);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:22px;box-shadow:0 16px 48px rgba(0,0,0,.45)}
    h1{margin:0 0 8px;font-size:18px}
    p{margin:0;color:#b8a88a;line-height:1.6}
    a{color:#c49a3a}
  </style>
</head>
<body>
  <main class="card">
    <h1>Starting the proxy...</h1>
    <p>Installing the service worker required for Ultraviolet. If this page doesn't continue, open <a href="/">Home</a>.</p>
  </main>
  <script>
    (async function () {
      if (!('serviceWorker' in navigator)) return location.replace('/');
      try { localStorage.setItem('bare-mux-path', '/baremux/worker.js'); } catch (e) {}
      try { await navigator.serviceWorker.register('/sw.js', { scope: '/' }); } catch (e) {}
      try { await navigator.serviceWorker.ready; } catch (e) {}
      try {
        const mux = await import('/baremux/index.mjs').catch(() => null);
        const BareMuxConnection = mux && mux.BareMuxConnection;
        if (BareMuxConnection) {
          const connection = new BareMuxConnection('/baremux/worker.js');
          const bareUrls = ${JSON.stringify(bareUrls)};
          await connection.setTransport('/baremod/index.mjs', bareUrls);
        }
      } catch (e) {}
      if (navigator.serviceWorker.controller) location.replace(${JSON.stringify(target)});
      else location.reload();
    })();
  </script>
</body>
</html>`);
  });

  app.get('/keys-1', (req, res) => {
    res.sendFile(join(publicDir, 'keys.html'));
  });
  app.get('/updates', (req, res) => {
    res.sendFile(join(publicDir, 'updates.html'));
  });
  app.get(['/proxy', '/proxy/'], (req, res) => {
    res.sendFile(join(publicDir, 'proxy.html'));
  });
  app.get('/', (req, res) => {
    res.sendFile(join(publicDir, 'index.html'));
  });

  app.use(
    express.static(publicDir, {
      setHeaders(res, filePath) {
        if (
          filePath.endsWith('.html') ||
          filePath.endsWith('.js') ||
          filePath.endsWith('.mjs') ||
          filePath.endsWith('.css') ||
          filePath.endsWith('.map')
        ) {
          // Prevent "clear site data" loops during development/updates.
          res.setHeader('Cache-Control', 'no-store');
        }
      },
    })
  );
}
