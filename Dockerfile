# syntax=docker/dockerfile:1
#
# Root-level Dockerfile for Railway and any container host.
#
# WHY THIS EXISTS: app/Dockerfile has `COPY package.json`, which only resolves
# if the build context IS app/. Railway's default context is the repo root, so
# pointing dockerfilePath at app/Dockerfile while leaving the context at the
# root fails with "package.json not found". This file has no such ambiguity:
# the context is the repo root, and every path is prefixed with app/.

FROM node:22-alpine AS runtime

RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    FG_DATA_DIR=/data

WORKDIR /app

COPY app/package.json ./
COPY app/src/ ./src/
COPY app/config/ ./config/
COPY app/public/ ./public/
COPY app/test/ ./test/
COPY app/map/ ./map/

RUN mkdir -p /data && chown -R node:node /data && chmod 755 /data && chmod -R a+rX /app

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
