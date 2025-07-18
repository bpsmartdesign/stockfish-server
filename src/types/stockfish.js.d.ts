declare module "stockfish.js" {
  interface Stockfish {
    onmessage: (event: string) => void;
    postMessage: (command: string) => void;
    terminate: () => void;
  }

  const Stockfish: {
    new (): Stockfish;
  };

  export default Stockfish;
}
