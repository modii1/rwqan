# ---------- Stage 1: build ----------
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
ENV NODE_OPTIONS=--max-old-space-size=4096 \
    NODE_ENV=production
RUN npm run build

# ---------- Stage 2: production node_modules only ----------
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --legacy-peer-deps --omit=dev

# ---------- Stage 3: runtime ----------
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/package-lock.json ./package-lock.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

EXPOSE 8080
CMD ["node", "dist/server/index.js"]
