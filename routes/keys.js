/**
 * Key management routes: verify passcode, list/create keys, unlock (claim) key, revoke.
 */

import { Router } from 'express';
import config, { expirationToDurationMs } from '../config/index.js';
import * as keysStorage from '../storage/keys.js';
import { requirePasscode } from '../middleware/auth.js';

const router = Router();
const BYPASS_DURATION_MS = 10 * 60 * 1000;

router.post('/verify-passcode', (req, res) => {
  const { passcode } = req.body || {};
  if (passcode === config.ADMIN_PASSCODE) {
    req.session.passcodeVerified = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, reason: 'invalid_passcode' });
});

function getBypassCookieOptions(req) {
  const secure = !!(req.secure || process.env.VERCEL);
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
  };
}

router.get('/list', requirePasscode, (req, res) => {
  const includeHidden = req.query.hidden === '1' || req.query.includeHidden === '1';
  const includeExpired = req.query.expired === '1' || req.query.includeExpired === '1';
  res.json({ ok: true, keys: keysStorage.listKeys(includeHidden, includeExpired) });
});

router.post('/bypass', (req, res) => {
  const until = Date.now() + BYPASS_DURATION_MS;
  res.cookie('bypassUntil', String(until), getBypassCookieOptions(req));
  res.json({ ok: true, until });
});

router.post('/bypass/clear', (req, res) => {
  const secure = !!(req.secure || process.env.VERCEL);
  res.cookie('bypassUntil', '', { httpOnly: true, sameSite: 'lax', secure, path: '/', expires: new Date(0) });
  res.json({ ok: true });
});

router.get('/allowed', (req, res) => {
  const bypassUntilRaw = req.cookies?.bypassUntil;
  const bypassUntil = bypassUntilRaw ? parseInt(String(bypassUntilRaw), 10) : 0;
  if (bypassUntil && bypassUntil > Date.now()) {
    return res.json({ ok: true, allowed: true, via: 'bypass' });
  }

  const { deviceId, bound } = resolveDeviceIdWithBoundKey(req);
  if (!deviceId) return res.json({ ok: true, allowed: false });
  if (!bound) return res.json({ ok: true, allowed: false });
  res.json({ ok: true, allowed: true, via: 'key' });
});

router.post('/create', requirePasscode, (req, res) => {
  const { name, expiration } = req.body || {};
  const expiresInMs = expirationToDurationMs(expiration);
  const created = keysStorage.createKey({
    name: (name && String(name).trim()) || 'Unnamed',
    expiresInMs,
  });
  res.json({
    ok: true,
    key: {
      id: created.id,
      name: created.name,
      key: created.key,
      expiresAt: created.expiresAt,
      expiresInMs: created.expiresInMs,
    },
  });
});

router.post('/revoke', requirePasscode, (req, res) => {
  const { keyId, secret } = req.body || {};
  if (secret !== config.REVOKE_SECRET) {
    return res.status(403).json({ ok: false, reason: 'invalid_revoke_secret' });
  }
  if (!keyId) return res.status(400).json({ ok: false, reason: 'key_id_required' });
  const revoked = keysStorage.revokeKey(keyId);
  if (!revoked) return res.status(404).json({ ok: false, reason: 'key_not_found' });
  res.json({ ok: true });
});

function getDeviceIdCookieOptions(req) {
  const secure = !!(req.secure || process.env.VERCEL);
  return { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure };
}

function resolveDeviceIdWithBoundKey(req) {
  const rawCandidates = [req.headers['x-device-id'], req.query.deviceId, req.cookies?.deviceId];
  const candidates = rawCandidates
    .map((v) => (v == null ? '' : String(v).trim()))
    .filter((v) => v);

  let deviceId = null;
  let bound = null;

  for (const id of candidates) {
    const key = keysStorage.getBoundKeyForDevice(id);
    if (key) {
      deviceId = id;
      bound = key;
      break;
    }
  }

  if (!deviceId && candidates.length) deviceId = candidates[0];
  return { deviceId, bound };
}

router.post('/unlock', (req, res) => {
  const { key, deviceId } = req.body || {};
  if (!key || !deviceId) {
    return res.status(400).json({ ok: false, reason: 'key_and_device_id_required' });
  }
  const userAgent = req.headers['user-agent'] || null;
  const result = keysStorage.claimKey(String(key).trim(), String(deviceId), userAgent);
  if (!result.ok) {
    return res.status(403).json({ ok: false, reason: result.reason });
  }
  res.cookie('deviceId', String(deviceId), getDeviceIdCookieOptions(req));
  res.json({ ok: true, keyId: result.keyId, name: result.name, expiresAt: result.expiresAt });
});

router.post('/hide', requirePasscode, (req, res) => {
  const { keyId } = req.body || {};
  if (!keyId) return res.status(400).json({ ok: false, reason: 'key_id_required' });
  const ok = keysStorage.hideKey(keyId);
  if (!ok) return res.status(404).json({ ok: false, reason: 'key_not_found' });
  res.json({ ok: true });
});

router.get('/check', (req, res) => {
  const cookieId = req.cookies?.deviceId ? String(req.cookies.deviceId).trim() : '';
  const { deviceId, bound } = resolveDeviceIdWithBoundKey(req);
  if (!deviceId) return res.json({ ok: false, unlocked: false });
  if (bound && deviceId) {
    res.cookie('deviceId', String(deviceId), getDeviceIdCookieOptions(req));
  } else if (!cookieId && deviceId) {
    // Only set cookie from an unbound id if no cookie exists.
    res.cookie('deviceId', String(deviceId), getDeviceIdCookieOptions(req));
  }
  if (!bound) return res.json({ ok: true, unlocked: false });
  res.json({
    ok: true,
    unlocked: true,
    keyId: bound.id,
    name: bound.name,
    expiresAt: bound.expiresAt,
  });
});

export default router;
