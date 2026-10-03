# ---- build ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json .npmrc ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json .npmrc ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server-dist ./server-dist
# Executa sem privilégios de root
RUN chown -R node:node /app
USER node
# O Cloud Run define PORT (8080) automaticamente
CMD ["node", "server-dist/server.js"]
