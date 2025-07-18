# Base image
FROM node:20-slim

# Install stockfish
RUN apt-get update && apt-get install -y stockfish

# Set working dir
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy files
COPY . .

# Install dependencies
RUN pnpm install

# Expose port
EXPOSE 3000

# Run server
CMD ["pnpm", "dev"]
