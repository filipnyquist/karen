FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build
FROM base AS build
COPY --from=install /app/node_modules ./node_modules
COPY . .
RUN bun run build

# Production
FROM base AS release
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json .
COPY --from=build /app/src ./src
COPY --from=build /app/drizzle.config.ts .
RUN mkdir -p /app/uploads

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "src/server.ts"]
