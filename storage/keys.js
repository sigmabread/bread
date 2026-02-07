/**
 * Key storage: in-memory with optional JSON file persistence.
 * Keys have: id, name, key (secret), expiresAt, expiresInMs, boundDeviceId, boundAt, boundUserAgent, hidden, createdAt.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

let keys = new Map();
let keyBySecret = new Map();
let dataFilePath = null;

function generateId() {
  return 'key_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
}

/** Generate a random key secret (alphanumeric, 16 chars). */
export function generateKeySecret() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export function setDataFilePath(path) {
  dataFilePath = path;
}

export async function load() {
  if (!dataFilePath) return;
  try {
    const raw = await readFile(dataFilePath, 'utf8');
    const arr = JSON.parse(raw);
    keys.clear();
    keyBySecret.clear();
    for (const k of arr) {
      // Coerce numeric fields that may be stored as strings (including legacy ISO timestamps).
      for (const field of ['expiresAt', 'expiresInMs', 'boundAt', 'createdAt']) {
        if (k[field] == null) continue;
        if (typeof k[field] === 'number') continue;
        if (typeof k[field] === 'string') {
          const trimmed = k[field].trim();
          const asInt = /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : Number.NaN;
          const asDate = Number.isFinite(asInt) ? asInt : Date.parse(trimmed);
          if (Number.isFinite(asDate)) k[field] = asDate;
          else k[field] = null;
        } else {
          k[field] = null;
        }
      }

      if (k.hidden === undefined) k.hidden = false;
      if (k.boundAt === undefined) k.boundAt = null;
      if (k.boundUserAgent === undefined) k.boundUserAgent = null;
      if (k.expiresInMs === undefined) k.expiresInMs = null;
      if (k.createdAt === undefined || typeof k.createdAt !== 'number') {
        // Best-effort: if old data didn't track createdAt, approximate using boundAt when available.
        k.createdAt = typeof k.boundAt === 'number' ? k.boundAt : Date.now();
      }

      // Migration/back-compat: if a key was stored with a duration but no absolute expiration,
      // treat the duration as "from creation time" (not "after bind") so keys actually expire.
      if (k.expiresAt == null && k.expiresInMs != null) {
        const base = typeof k.createdAt === 'number' ? k.createdAt : Date.now();
        k.expiresAt = base + Math.max(0, Number(k.expiresInMs) || 0);
      }

      keys.set(k.id, k);
      keyBySecret.set(k.key, k);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Keys load error:', e.message);
  }
}

async function save() {
  if (!dataFilePath) return;
  try {
    await mkdir(dirname(dataFilePath), { recursive: true });
    const arr = Array.from(keys.values());
    await writeFile(dataFilePath, JSON.stringify(arr, null, 2), 'utf8');
  } catch (e) {
    console.error('Keys save error:', e.message);
  }
}

export function createKey({ name, expiresAt, expiresInMs, key: secret }) {
  const id = generateId();
  const keySecret = secret && String(secret).trim() ? secret.trim() : generateKeySecret();
  const durationMs = expiresInMs != null ? Math.max(0, Number(expiresInMs) || 0) : null;
  const absoluteExpiresAt = expiresAt != null ? expiresAt : (durationMs != null ? (Date.now() + durationMs) : null);
  const key = {
    id,
    name: name || 'Unnamed',
    key: keySecret,
    expiresAt: absoluteExpiresAt,
    // keep original duration for display/debugging
    expiresInMs: durationMs,
    boundDeviceId: null,
    boundAt: null,
    boundUserAgent: null,
    hidden: false,
    createdAt: Date.now(),
  };
  keys.set(id, key);
  keyBySecret.set(key.key, key);
  save();
  return key;
}

export function getKeyById(id) {
  return keys.get(id) || null;
}

export function getKeyBySecret(secret) {
  return keyBySecret.get(secret) || null;
}

export function isKeyValid(keyObj, deviceId) {
  if (!keyObj) return false;
  if (keyObj.expiresAt != null && Date.now() > keyObj.expiresAt) return false;
  if (keyObj.boundDeviceId != null && keyObj.boundDeviceId !== deviceId) return false;
  return true;
}

export function bindKeyToDevice(secret, deviceId) {
  const key = keyBySecret.get(secret);
  if (!key || key.boundDeviceId != null) return false;
  key.boundDeviceId = deviceId;
  save();
  return true;
}

export function claimKey(secret, deviceId, userAgent) {
  const key = keyBySecret.get(secret);
  if (!key) return { ok: false, reason: 'invalid_key' };
  if (key.expiresAt != null && Date.now() > key.expiresAt) return { ok: false, reason: 'expired' };
  if (key.boundDeviceId != null && key.boundDeviceId !== deviceId) return { ok: false, reason: 'already_used' };
  if (key.boundDeviceId == null) {
    key.boundDeviceId = deviceId;
    key.boundAt = Date.now();
    key.boundUserAgent = userAgent || null;
    save();
  }
  return {
    ok: true,
    keyId: key.id,
    name: key.name,
    expiresAt: key.expiresAt,
  };
}

export function listKeys(includeHidden = false, includeExpired = false) {
  const now = Date.now();
  return Array.from(keys.values())
    .filter((k) => (includeHidden || !k.hidden) && (includeExpired || k.expiresAt == null || k.expiresAt > now))
    .map((k) => ({
      id: k.id,
      name: k.name,
      key: k.key,
      expiresAt: k.expiresAt,
      expiresInMs: k.expiresInMs,
      boundDeviceId: k.boundDeviceId,
      boundAt: k.boundAt,
      boundUserAgent: k.boundUserAgent,
      hidden: k.hidden,
      createdAt: k.createdAt,
    }));
}

export function getBoundKeyForDevice(deviceId) {
  const now = Date.now();
  let expiredFound = false;
  for (const k of keys.values()) {
    if (k.boundDeviceId !== deviceId) continue;
    if (k.expiresAt != null && now > k.expiresAt) {
      expiredFound = true;
      continue;
    }
    return k;
  }
  // If all matching keys are expired, treat as unbound.
  if (expiredFound) return null;
  return null;
}

/** Expire a key immediately (revoke). Requires key id. */
export function revokeKey(keyId) {
  const key = keys.get(keyId);
  if (!key) return false;
  key.expiresAt = Date.now();
  save();
  return true;
}

/** Remove key from list (hide). Key stays in DB. */
export function hideKey(keyId) {
  const key = keys.get(keyId);
  if (!key) return false;
  key.hidden = true;
  save();
  return true;
}
