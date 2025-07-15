import express from "express";
import cors from "cors";
import stockfishFactory from "stockfish";

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.post("/move", (req, res) => {
  const { moves = [], level = 5, depth = 12 } = req.body as {
    moves: string[];
    level?: number;
    depth?: number;
  };

  const engine = stockfishFactory();
  let resolved = false;

  engine.onmessage = (line: string) => {
    if (typeof line !== "string") return;

    if (line.startsWith("bestmove") && !resolved) {
      resolved = true;
      const bestMove = line.split(" ")[1];
      res.json({ bestMove });
    }
  };

  engine.postMessage("uci");
  engine.postMessage("ucinewgame");
  engine.postMessage(`setoption name Skill Level value ${Math.max(0, Math.min(level, 20))}`);
  engine.postMessage(`position startpos moves ${moves.join(" ")}`);
  engine.postMessage(`go depth ${depth}`);
});

app.listen(port, () => {
  console.log(`♟️ Stockfish TypeScript server is running at http://localhost:${port}`);
});
