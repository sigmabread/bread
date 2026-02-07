# Bread Proxy – Setup & Deploy

## Push to a GitHub repository

1. **Create a new repo on GitHub**  
   Go to [github.com/new](https://github.com/new), choose a name (e.g. `bread-proxy`), and create the repository. (If you already have a README/.gitignore locally, donâ€™t add them on GitHub.)

2. **Initialize Git locally (if you haven’t)**  
   From the project root:

   ```bash
   git init
   git status
   git add .
   git commit -m "Initial commit: Bread Proxy"
   ```

3. **Add the remote and push**  
   Replace `YOUR_USERNAME` and `YOUR_REPO` with your GitHub username and repo name:

   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git branch -M main
   git push -u origin main
   ```

   If the repo already has content (e.g. a README), pull first:

   ```bash
   git pull origin main --rebase
   git push -u origin main
   ```

4. **Optional: .env and secrets**  
   Don’t commit secrets. Use environment variables and set them in your host (Vercel, Railway, etc.):

   - `ADMIN_PASSCODE` – passcode for `/keys-1`
   - `REVOKE_SECRET` – secret for revoke/expire actions
   - `SESSION_SECRET` – session signing secret

---

## Deploy on Vercel

Bread Proxy is set up to run on Vercel as a serverless app.

1. **Install Vercel CLI (optional)**  
   ```bash
   npm i -g vercel
   ```

2. **Deploy**  
   From the project root:

   ```bash
   vercel
   ```

   Or connect the GitHub repo in the [Vercel dashboard](https://vercel.com/new): import the repo, leave build settings as default, add env vars if needed, then deploy.

3. **Environment variables (Vercel)**  
   In the project → Settings → Environment Variables, add:

   - `ADMIN_PASSCODE` (e.g. `1fj4`)
   - `REVOKE_SECRET` (e.g. `1fj3`)
   - `SESSION_SECRET` (a long random string)

4. **Keys storage on Vercel**  
    On Vercel, the app uses `/tmp/keys.json` when `VERCEL` is set. Data in `/tmp` is **ephemeral** (lost on cold starts). For a production setup with persistent keys, use an external store (e.g. Vercel KV, Upstash Redis) and point the app at it via a custom adapter or `KEYS_DATA_FILE` if you add support for a URL/connection string.

5. **Important: device cookie + HTTPS**
   The proxy requires a `deviceId` cookie so Bare requests to `/bare/` can be authorized. On Vercel (HTTPS), the cookie is marked `Secure` automatically.

6. **Bare server (recommended for serverless)**
   Vercel serverless functions generally cannot support Bare upgrades (WebSocket). For Scramjet to work reliably on Vercel, deploy a Bare server separately (e.g. Koyeb) and set:

   - `BARE_URL` (example: `https://YOUR-KOYEB-APP.koyeb.app/bare/`)
     If you do not know the Koyeb URL yet, **leave `BARE_URL` unset for now**. The app will fall back to its own `/bare/` endpoint. Once your Koyeb service is deployed, copy the public URL from the Koyeb dashboard and set:
     `BARE_URL=https://YOUR-KOYEB-APP.koyeb.app/bare/`, then redeploy.

---

## Deploy on Koyeb (recommended for 24/7)

Koyeb runs the full Node server (including `/bare/` upgrades), which is ideal for BREADroids (Scramjet + Bare).

1. Create a Web Service from your GitHub repo.
2. Set:
   - Build command: `npm install`
   - Run command: `npm start`
3. Ensure the service listens on the provided `PORT` environment variable (this app does).
4. Note: Koyeb Free instances scale-to-zero after 1 hour of inactivity. For always-on behavior, use a paid plan (or send periodic traffic).
5. Optional env vars:
   - `ADMIN_PASSCODE`, `REVOKE_SECRET`, `SESSION_SECRET`
   - `KEYS_DATA_FILE` (defaults to `./data/keys.json`, or `/tmp/keys.json` on Vercel)

---

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`. Home: `/`. Proxy UI: `/proxy`. Keys admin: `/keys-1`. Update logs: `/updates`. Proxy prefix: `/sj/`. Bare: `/bare/`.

---

## Custom expiration format

When creating a key with **Custom** expiration, use a value like:

- `1s`, `3s` - seconds
- `2.23m`, `10m` - minutes (rounded to the nearest ms)
- `1.5h`, `24h` - hours
- `2d`, `7d` - days

Examples: `1s`, `3s`, `2.23m`, `1.5h`, `2d`.
