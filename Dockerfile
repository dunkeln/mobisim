FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY build ./build
COPY static ./static
COPY storage ./storage

RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["node", "build"]
