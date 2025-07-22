# Base image
FROM node:20-slim

# Add contrib repo and install stockfish
RUN apt-get update && \
    apt-get install -y gnupg2 curl && \
    echo "deb http://deb.debian.org/debian bullseye main contrib non-free" > /etc/apt/sources.list && \
    apt-get update && \
    apt-get install -y stockfish && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy app code
COPY . .

# Install dependencies
RUN pnpm install

# Expose port
EXPOSE 3000

# Start app
CMD ["pnpm", "start"]
