# Build the web page, then run the API server (which also serves web/dist).
# Real mode (owner-run) calls PingOne SaaS read-only with worker client credentials from the environment;
# nothing is baked into the image.
FROM node:26-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci
COPY web web
# The page imports the shared, dependency-free readable.js (Easy read table/form and JSON tokens).
COPY server/src/readable.js server/src/readable.js
RUN npm run build -w web

FROM node:26-alpine
WORKDIR /app
# MODE is empty: Real when the PINGONE_* settings are passed in and usable, else Mock.
ENV NODE_ENV=production PORT=7811 MODE=
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY server/src server/src
COPY server/diagrams server/diagrams
COPY --from=web /app/web/dist web/dist
USER node
EXPOSE 7811
# Inside the container the server must listen on all interfaces, so POWASP_BIND is set here on purpose.
# The compose file publishes the port on 127.0.0.1 only; do not publish it more widely.
ENV POWASP_BIND=0.0.0.0
CMD ["node", "server/src/index.js"]
