FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

FROM node:18-alpine AS runner
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app ./
EXPOSE 5000
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
CMD ["npm", "start"]
