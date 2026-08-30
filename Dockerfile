# GestionMoney needs nothing but Python. No packages, no build step.
FROM python:3.12-slim

WORKDIR /app

# Copy every module rather than naming them one by one - naming them is how
# auth.py got left out once already.
COPY *.py ./
COPY web/ ./web/
COPY tools/ ./tools/
COPY docker-entrypoint.sh /usr/local/bin/

# Fail the build rather than ship an image that cannot start.
RUN python -c "import server, api, db, auth" \
 && python -m compileall -q . \
 && useradd --system --uid 10001 --create-home gm \
 && mkdir -p /app/data \
 && chown -R gm:gm /app \
 && sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
 && chmod +x /usr/local/bin/docker-entrypoint.sh

# No VOLUME instruction on purpose: Railway rejects it, and every other host is
# happy to mount over a plain directory. Attach persistent storage at /app/data
# or your budgets vanish on the next deploy.

# GM_PORT wins if set; otherwise the app follows the platform's PORT.
# Unbuffered, or the startup banner (with its no-password warning) never
# reaches the platform's log view.
ENV GM_HOST=0.0.0.0 PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request,os;\
urllib.request.urlopen('http://127.0.0.1:'+(os.environ.get('GM_PORT') or os.environ.get('PORT') or '8765')+'/api/auth',timeout=4)"

# Starts as root only to fix the mounted volume's ownership, then drops to `gm`.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["python", "server.py", "--no-browser"]
