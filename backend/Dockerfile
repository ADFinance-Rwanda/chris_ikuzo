FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY backend/package.json ./package.json
COPY backend/package-lock.json ./package-lock.json
RUN npm ci --omit=dev
COPY backend/src ./backend/src
COPY scripts/migrate.js ./scripts/migrate.js
COPY database/migrations ./migrations
ENV MIGRATIONS_DIR=/app/migrations
USER node
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.js && node backend/src/index.js"]
