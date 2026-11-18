# syntax=docker/dockerfile:1

# =============================================================================
# Flight Guide — multi-stage build
#
# Stage 1 (`deps`) exists to run `npm ci` for a future version of the app that
# grows dependencies. Today the app has none, so it also validates package.json
# and fails the build early if the manifest is malformed. Keeping the stage means
# adding a dependency later is a package.json change, not a Dockerfile rewrite.
# =============================================================================

FROM node:22-alpine AS deps
WORKDIR /app

# Only the manifest is copied so this layer caches on dependency changes alone.
COPY package.json ./

# Fail the build early on a malformed manifest. The app currently ships with
# zero runtime dependencies, so there is nothing to install. When a dependency
# is added, replace this line with:  RUN npm ci --omit=dev --no-audit --no-fund
RUN mkdir -p node_modules \
 && node -e "const p=require('./package.json');const d=Object.keys(p.dependencies||{});console.log(d.length?'deps: '+d.join(', '):'no runtime dependencies — nothing to install')"


# =============================================================================
# Stage 2 (`runtime`) — the only stage that ships.
# =============================================================================

FROM node:22-alpine AS runtime

# `tini` reaps the Node process so SIGTERM reaches it on `docker stop`.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    FG_DATA_DIR=/data

WORKDIR /app

# Application code, owned by root and read-only to the app user.
COPY --chown=root:root package.json ./
COPY --chown=root:root src/ ./src/
COPY --chown=root:root config/ ./config/
COPY --chown=root:root public/ ./public/
COPY --chown=root:root map/ ./map/

# node_modules is created empty in the deps stage (see above) so this COPY
# always succeeds. Add a dependency and the same path starts carrying it.
COPY --from=deps --chown=root:root --parents /app/node_modules ./

# Make the read-only tree world-readable regardless of how the build context
# stored its permissions, so uid 1000 can always read the app.
RUN chmod -R a+rX /app

# The one writable path: persisted settings + conversation log.
RUN mkdir -p /data \
 && chown -R node:node /data \
 && chmod 755 /data

# Ship as the image's built-in unprivileged user (uid 1000), never root.
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
