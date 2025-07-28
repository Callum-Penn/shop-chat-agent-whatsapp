# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client and build the app
RUN npx prisma generate
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built app
COPY --from=builder /app/build /app/build
COPY --from=builder /app/public /app/public

# Create a startup script
RUN echo '#!/bin/sh' > /start.sh && \
    echo 'cd /app' >> /start.sh && \
    echo 'npx prisma generate' >> /start.sh && \
    echo 'npx prisma db push' >> /start.sh && \
    echo 'remix-serve ./build/server/index.js --host 0.0.0.0 --port 3000 &' >> /start.sh && \
    echo 'nginx -g "daemon off;"' >> /start.sh && \
    chmod +x /start.sh

# Install Node.js in the nginx container
RUN apk add --no-cache nodejs npm

# Copy package files for runtime
COPY package*.json ./
COPY prisma ./prisma/

# Install only production dependencies
RUN npm ci --only=production

EXPOSE 8080

CMD ["/start.sh"]
