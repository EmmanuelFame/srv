# Cloud Bot VPS Hosting

This folder contains the host-friendly deployment files for running `cloud-bot`
on the GlyGold VPS.

## What changed

- `docker-compose.legacy.yml` is the original standalone setup that expected to
  own ports `80`, `443`, and `6379`.
- `compose.vps.yml` is the version for this VPS, where host Caddy already owns
  ports `80/443`.
- `.env.production.example` is a sanitized template. The original cloned `.env`
  was removed from the working tree after being backed up outside the repo.
- `deploy/Caddyfile.bot` is the Caddy site block for `bot.safecareorganisation.org`.

## Deploy on this VPS

1. Copy the template and fill in real secrets:

```bash
cd /opt/glygold/tmp/srv/cloud-bot
cp .env.production.example .env.production
```

2. Build and start the bot:

```bash
docker compose -f compose.vps.yml up -d --build
```

3. Add the bot site block from `deploy/Caddyfile.bot` to `/etc/caddy/Caddyfile`
   and reload Caddy:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

4. Smoke-check locally:

```bash
curl http://127.0.0.1:3001/healthz
curl "http://127.0.0.1:3001/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=YOUR_VERIFY_TOKEN&hub.challenge=123"
```

## Notes

- This app currently stores session state in memory, so Redis is not required
  if you are only testing. On this VPS deployment we use Redis for durable
  sessions and message dedupe.
- The old public repo appeared to include live secrets. Rotate the WhatsApp and
  backend keys before using this deployment.
