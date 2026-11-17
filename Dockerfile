FROM node:24-alpine3.24 AS build
WORKDIR /app
ARG BUILD_SHA=
ARG VITE_API_BASE=/api
ENV BUILD_SHA=$BUILD_SHA VITE_API_BASE=$VITE_API_BASE
COPY package*.json ./
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine3.24
# yt-dlp: last fallback for TikTok downloads.
RUN apk add --no-cache ffmpeg yt-dlp whisper.cpp
# Multilingual Whisper base (Q5_1), packaged at build time for offline recognition.
RUN mkdir -p /opt/whisper && wget -q -O /opt/whisper/base.bin \
      https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base-q5_1.bin && \
    echo '422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898  /opt/whisper/base.bin' | sha256sum -c -
ENV WHISPER_MODEL=/opt/whisper/base.bin
COPY packaging/whisper/LICENSE /opt/whisper/LICENSE
ARG BUILD_SHA=
ENV NODE_ENV=production PORT=3001 BUILD_SHA=$BUILD_SHA
WORKDIR /app
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-server ./dist-server
COPY --from=build --chown=node:node /app/scripts/grant-admin.mjs ./scripts/grant-admin.mjs
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","dist-server/index.js"]
