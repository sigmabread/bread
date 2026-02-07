# BREADroids (Bread Proxy)

Chrome-like, bread-themed web proxy UI powered by Scramjet + BareMux, gated per-device via keys (one key = one device; first use binds it).

## Routes

- Home: `http://localhost:3000/`
- Proxy UI (dedicated page): `http://localhost:3000/proxy`
- Keys admin: `http://localhost:3000/keys-1`
- Update logs: `http://localhost:3000/updates`
- Scramjet prefix: `/sj/`
- Bare server: `/bare/`
- Health checks: `/api/status`, `/api/selftest`

## Quick start

```bash
npm install
npm start
```

## Configuration (env vars)

- `PORT` (default: `3000`)
- `ADMIN_PASSCODE` (default: `1fj4`)
- `REVOKE_SECRET` (default: `1fj3`)
- `SESSION_SECRET` (default: `bread-proxy-secret-change-in-production`)
- `KEYS_DATA_FILE` (default: `./data/keys.json`)
- `BARE_MAX_CONNECTIONS_PER_IP` (default: `25000`)
- `BARE_CONNECTION_WINDOW_DURATION` (default: `60`)
- `BARE_CONNECTION_BLOCK_DURATION` (default: `1`)

## Notes

- If you run this on `localhost`, the proxy *egress IP* will still be your own machine/connection. To change the IP sites see, host BREADroids on a remote server.
