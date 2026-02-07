/**
 * Bread Proxy - Central configuration
 */

const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || '1fj4';
const REVOKE_SECRET = process.env.REVOKE_SECRET || '1fj3'; // Required for revoke/expire-early and other destructive actions
const SESSION_SECRET = process.env.SESSION_SECRET || 'bread-proxy-secret-change-in-production';
const PORT = parseInt(process.env.PORT || '3000', 10);
const PROXY_PATH = '/go';
const KEYS_DATA_FILE = process.env.KEYS_DATA_FILE || (process.env.VERCEL ? '/tmp/keys.json' : './data/keys.json');

// Optional: use an external Bare server (changes the IP websites see and improves serverless compatibility).
// Can be a single URL (BARE_URL) or comma-separated list (BARE_URLS).
const BARE_URL = process.env.BARE_URL || '';
const BARE_URLS = process.env.BARE_URLS || '';

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

/** Parse custom duration string: e.g. "1s", "3s", "2.23m", "1.5h", "2d" (rounded to ms). Returns ms or null. */
function parseCustomDuration(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  const m = trimmed.match(/^([\d.]+)\s*(s|m|h|d)$/i);
  if (!m) return null;
  const num = Math.max(0, parseFloat(m[1]));
  const unit = (m[2] || '').toLowerCase();
  const multipliers = { s: S, m: M, h: H, d: D };
  const mult = multipliers[unit];
  if (!mult) return null;
  return Math.round(num * mult);
}

/** Expiration presets or custom string -> duration in ms (null = forever) */
export function expirationToDurationMs(preset) {
  if (!preset || preset === 'forever') return null;
  const map = {
    '24h': 1 * D,
    '3d': 3 * D,
    '7d': 7 * D,
    '1m': 30 * D,
    '2m': 60 * D,
    '3m': 90 * D,
    '6m': 180 * D,
  };
  const fromMap = map[preset];
  if (fromMap != null) return fromMap;
  return parseCustomDuration(preset);
}

/** Back-compat: expiration preset/custom -> absolute ms timestamp from now (null = forever). */
export function expirationToMs(preset) {
  const dur = expirationToDurationMs(preset);
  return dur == null ? null : (Date.now() + dur);
}

export default {
  ADMIN_PASSCODE,
  REVOKE_SECRET,
  SESSION_SECRET,
  PORT,
  PROXY_PATH,
  KEYS_DATA_FILE,
  BARE_URL,
  BARE_URLS,
  MAX_REQUEST_SIZE: '50mb',
  PROXY_TIMEOUT_MS: 30000,
  ALLOWED_ORIGINS: ['*'],
};
