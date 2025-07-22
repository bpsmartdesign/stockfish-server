import { spawn } from "child_process";

export function createStockfishEngine() {
  // const engine = spawn("stockfish");
  const engine = spawn('/usr/games/stockfish');
  const listeners = [];

  engine.stdout.on("data", (data) => {
    data
      .toString()
      .split("\n")
      .forEach((line) => {
        if (line.trim()) {
          listeners.forEach((cb) => cb(line.trim()));
        }
      });
  });

  return {
    postMessage: (cmd) => engine.stdin.write(cmd + "\n"),
    addMessageListener: (cb) => listeners.push(cb),
    removeMessageListener: (cb) => {
      const index = listeners.indexOf(cb);
      if (index !== -1) listeners.splice(index, 1);
    },
    terminate: () => engine.kill(),
  };
}
