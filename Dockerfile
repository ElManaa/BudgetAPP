# GestionMoney needs nothing but Python. No packages, no build step.
FROM python:3.12-slim

WORKDIR /app
COPY server.py api.py db.py ./
COPY web/ ./web/
COPY tools/ ./tools/

# Each profile's SQLite file lives here. Mount a volume on it or your data
# disappears the next time the container is replaced.
VOLUME ["/app/data"]

ENV GM_HOST=0.0.0.0 GM_PORT=8765
EXPOSE 8765

# NOTE: this app has no login of its own. Put it behind Tailscale,
# Cloudflare Access, or a reverse proxy that authenticates.
CMD ["python", "server.py", "--no-browser"]
