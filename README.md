# BREAD (Bread Proxy)

Chrome-like, bread-themed web proxy UI powered by Scramjet + BareMux, -- now becom ULTRAVIOLET not scramjet -- gated per-device via keys (one key = one device; first use binds it).

## Quick start

```bash
npm install
npm start
```

## Configuration (env vars)

- `PORT` (default: `3000`)
- `SESSION_SECRET` (default: `bread-proxy-secret-change-in-production`)
- `KEYS_DATA_FILE` (default: `./data/keys.json`)
- `BARE_MAX_CONNECTIONS_PER_IP` (default: `25000`)
- `BARE_CONNECTION_WINDOW_DURATION` (default: `60`)
- `BARE_CONNECTION_BLOCK_DURATION` (default: `1`)

## Notes

- If you run this on `localhost`, the proxy *egress IP* will still be your own machine/connection. To change the IP sites see, host BREAD on a remote server.
