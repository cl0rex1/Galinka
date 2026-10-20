FROM node:24-alpine AS build
WORKDIR /app
ARG BUILD_SHA=0.2.0
ARG VITE_API_BASE=/api
ENV BUILD_SHA=$BUILD_SHA VITE_API_BASE=$VITE_API_BASE
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
ARG BUILD_SHA=0.2.0
ENV NODE_ENV=production PORT=3001 BUILD_SHA=$BUILD_SHA
WORKDIR /app
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-server ./dist-server
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","dist-server/index.js"]
