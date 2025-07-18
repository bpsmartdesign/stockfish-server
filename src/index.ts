import express from "express";
import cors from "cors";
import StockfishWasm from "stockfish.wasm";
import { Chess } from "chess.js";
import { Game } from "./types/app";
import {
  convertMoveToVibration,
  updateGameStatus,
  validateMove,
} from "./utils/commont";

// Type for initialized Stockfish engine
type StockfishEngine = Awaited<ReturnType<typeof StockfishWasm>>;

interface ActiveGame {
  engine: StockfishEngine;
  game: Game;
}

const app = express();
app.use(cors());
app.use(express.json());

const activeGames = new Map<string, ActiveGame>();
const PORT = 3000;

// Create new game
app.post("/api/games", async (req, res) => {
  const { playerColor = "white", level = 2 } = req.body;

  try {
    // Initialize Stockfish engine
    const engine = await StockfishWasm();
    const gameId = Date.now().toString();

    // Set up new game state
    const game: Game = {
      id: gameId,
      chess: new Chess(),
      playerColor,
      stockfishLevel: Math.max(1, Math.min(20, level)),
      status: "waiting",
      moves: [],
      lastMoveAt: new Date(),
    };

    // Store game and engine
    activeGames.set(gameId, { engine, game });

    // Configure engine logging
    engine.addMessageListener((msg) => {
      console.debug(`[${gameId}] Engine: ${msg}`);
    });

    // Initialize engine
    engine.postMessage("uci");
    engine.postMessage("isready");

    // If player is black, make first move with Stockfish
    if (playerColor === "black") {
      setTimeout(() => makeStockfishMove(gameId), 500);
    }

    res.status(201).json({
      gameId,
      fen: game.chess.fen(),
      playerColor,
      stockfishLevel: game.stockfishLevel,
    });
  } catch (err) {
    console.error("Engine initialization failed:", err);
    res.status(500).json({ error: "Failed to initialize chess engine" });
  }
});

// Submit player move
app.post("/api/games/:id/moves", async (req, res) => {
  const gameId = req.params.id;
  const activeGame = activeGames.get(gameId);

  if (!activeGame) {
    return res.status(404).json({ error: "Game not found" });
  }

  const { engine, game } = activeGame;
  const { move } = req.body;

  // Validate move format
  if (!validateMove(move)) {
    return res.status(400).json({ error: "Invalid move format" });
  }

  try {
    // Execute player move
    game.chess.move(move);
    game.moves.push(move);
    updateGameStatus(game);

    // If game is still active, get Stockfish response
    if (game.status === "active") {
      await makeStockfishMove(gameId);
    }

    res.json({
      status: game.status,
      fen: game.chess.fen(),
      lastMove: move,
      vibrationSequence: game.vibrationSequence,
    });
  } catch (err) {
    console.error("Move failed:", err);
    res.status(400).json({ error: "Illegal move" });
  }
});

// Get game state
app.get("/api/games/:id", (req, res) => {
  const activeGame = activeGames.get(req.params.id);
  if (!activeGame) {
    return res.status(404).json({ error: "Game not found" });
  }

  const { game } = activeGame;
  res.json({
    status: game.status,
    fen: game.chess.fen(),
    moves: game.moves,
    vibrationSequence: game.vibrationSequence,
    lastMoveAt: game.lastMoveAt,
    playerColor: game.playerColor,
    stockfishLevel: game.stockfishLevel,
  });
});

// Stockfish move handler
async function makeStockfishMove(gameId: string): Promise<void> {
  const activeGame = activeGames.get(gameId);
  if (!activeGame || activeGame.game.status !== "active") return;

  const { engine, game } = activeGame;

  return new Promise((resolve) => {
    const handler = (msg: string) => {
      if (msg.includes("bestmove")) {
        engine.removeMessageListener(handler);

        const move = msg.match(/bestmove (\w+)/)?.[1];
        if (move && game.chess.move(move)) {
          game.moves.push(move);
          game.vibrationSequence = convertMoveToVibration(move);
          updateGameStatus(game);
        }

        resolve();
      }
    };

    engine.addMessageListener(handler);
    engine.postMessage(`position fen ${game.chess.fen()}`);
    engine.postMessage(`go depth ${Math.min(22, 5 + game.stockfishLevel)}`);
  });
}

// Clean up inactive games
setInterval(() => {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 3600000);

  for (const [gameId, activeGame] of activeGames) {
    const { engine, game } = activeGame;
    if (game.lastMoveAt && game.lastMoveAt < oneHourAgo) {
      try {
        engine.terminate();
        console.log(`Terminated game ${gameId}`);
      } catch (err) {
        console.error(`Error terminating engine for game ${gameId}:`, err);
      }
      activeGames.delete(gameId);
    }
  }
}, 3600000); // Run every hour

// Start server
app.listen(PORT, () => {
  console.log(`Chess server running on http://localhost:${PORT}`);
});
