FROM node:22.18-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src

ENV PORT=3001
ENV DATABASE_PATH=/data/asteroid-breaker.sqlite
EXPOSE 3001
VOLUME ["/data"]

CMD ["npm", "start"]
