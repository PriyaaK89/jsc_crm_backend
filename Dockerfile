# Build stage
FROM node:20 AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY . .

# Runtime stage
FROM node:20-slim AS runner

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .

EXPOSE 5000

RUN groupadd -r appgroup && useradd -r -g appgroup appuser

USER appuser

CMD ["npm", "start"]