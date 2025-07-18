declare module "stockfish.wasm" {
  interface StockfishInstance {
    addMessageListener(cb: (msg: string) => void): void;
    removeMessageListener(cb: (msg: string) => void): void;
    postMessage(msg: string): void;
    terminate(): void;
  }

  const StockfishWasm: {
    (): Promise<StockfishInstance>;
  };

  export default StockfishWasm;
}

// Then change your engine type to:
type StockfishEngine = Awaited<ReturnType<typeof StockfishWasm>>;
