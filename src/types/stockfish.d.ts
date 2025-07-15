declare module "stockfish" {
  export default function stockfish(): StockfishEngine;

  interface StockfishEngine {
    postMessage(message: string): void;
    onmessage: ((event: string) => void) | null;
  }
}
