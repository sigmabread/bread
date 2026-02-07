/**
 * Auth middleware: passcode session for /keys-1, device key for proxy.
 */

import config from '../config/index.js';
import * as keysStorage from '../storage/keys.js';

const BYPASS_COOKIE = 'bypassUntil';

export function requirePasscode(req, res, next) {
  if (req.session?.passcodeVerified) return next();
  res.status(401).json({ ok: false, reason: 'passcode_required' });
}

export function requireDeviceKey(req, res, next) {
  const bypassUntilRaw = req.cookies?.[BYPASS_COOKIE];
  const bypassUntil = bypassUntilRaw ? parseInt(String(bypassUntilRaw), 10) : 0;
  if (bypassUntil && bypassUntil > Date.now()) {
    req.bypassActive = true;
    return next();
  }

  const rawCandidates = [req.headers['x-device-id'], req.cookies?.deviceId];
  const candidates = rawCandidates
    .map((v) => (v == null ? '' : String(v).trim()))
    .filter((v) => v);

  let deviceId = null;
  let key = null;
  for (const id of candidates) {
    const bound = keysStorage.getBoundKeyForDevice(id);
    if (bound) {
      deviceId = id;
      key = bound;
      break;
    }
  }
  if (!deviceId && candidates.length) deviceId = candidates[0];

  if (!deviceId) {
    return res.status(403).json({ ok: false, reason: 'device_id_required' });
  }
  if (!key) {
    return res.status(403).json({ ok: false, reason: 'key_required' });
  }
  req.deviceId = deviceId;
  req.boundKey = key;
  next();
}

export function optionalDeviceKey(req, res, next) {
  const deviceId = req.headers['x-device-id'] || req.cookies?.deviceId;
  req.deviceId = deviceId || null;
  req.boundKey = deviceId ? keysStorage.getBoundKeyForDevice(deviceId) : null;
  next();
}
