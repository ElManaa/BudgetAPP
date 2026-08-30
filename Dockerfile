# GestionMoney needs nothing but Python. No packages, no build step.
FROM python:3.12-slim

WORKDIR /app

# Copy every module rather than naming them one by one - naming them is how
# auth.py got left out once already.
COPY *.py ./
COPY web/ ./web/
COPY tools/ ./tools/

# Fail the build rather than ship an image that cannot start.
RUN python -c "import server, api, db, auth" \
 && python -m compileall -q . \
 && useradd --system --uid 10001 --create-home gm \
 && mkdir -p /app/data \
 && chown -R gm:gm /app

# Each profile's SQLite file lives here. Mount a volume on it or your budget
# disappears the next time the container is replaced.
VOLUME ["/app/data"]

USER gm

# Unbuffered, or the startup banner (including the no-password warning) never
# reaches `docker logs`.
ENV GM_HOST=0.0.0.0 GM_PORT=8765 PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request,os;\
urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('GM_PORT','8765')+'/api/auth',timeout=4)"

# Set a password on first open (Settings -> Password lock), and still keep this
# behind Tailscale, Cloudflare Access or an authenticating proxy.
CMD ["python", "server.py", "--no-browser"]
