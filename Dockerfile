FROM node:20-slim

# Install stockfish binary and confirm it's in PATH
RUN apt-get update && \
    apt-get install -y stockfish && \
    which stockfish && \
    stockfish bench && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN npm install -g pnpm
COPY . .

RUN pnpm install

EXPOSE 3000

CMD ["pnpm", "start"]
