# Dockerfile for RAGdollLanguage
# Builds a standalone Next.js app for the language-learning frontend.

FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_BACKEND_API_URL
ARG NEXT_PUBLIC_SERVER_BACKEND_API_URL
ARG NEXT_PUBLIC_BASE_PATH
ARG TRANSLATION_PROVIDER
ARG GOOGLE_TRANSLATE_API_KEY

ENV NEXT_PUBLIC_BACKEND_API_URL=${NEXT_PUBLIC_BACKEND_API_URL}
ENV NEXT_PUBLIC_SERVER_BACKEND_API_URL=${NEXT_PUBLIC_SERVER_BACKEND_API_URL}
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
ENV TRANSLATION_PROVIDER=${TRANSLATION_PROVIDER}
ENV GOOGLE_TRANSLATE_API_KEY=${GOOGLE_TRANSLATE_API_KEY}
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3010

ENV PORT=3010
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
