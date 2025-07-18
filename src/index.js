import express from "express";
import cors from "cors";
import { Chess } from "chess.js";
import { createStockfishEngine } from "./engine.js";

class ChessServer {
  constructor() {
    this.app = express();
    this.activeGames = new Map();
    this.initMiddleware();
    this.initRoutes();
  }

  initMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
  }

  initRoutes() {
    this.app.post("/api/games", this.createGame.bind(this));
    this.app.post("/api/games/:id/moves", this.submitMove.bind(this));
    this.app.get("/api/games/:id", this.getGameState.bind(this));
  }

  async createGame(req, res) {
    const { playerColor = "white", level = 5 } = req.body;
    const engine = createStockfishEngine();
    const gameId = Date.now().toString();
    const chess = new Chess();

    this.activeGames.set(gameId, {
      engine,
      game: {
        chess,
        playerColor,
        stockfishLevel: level,
        status: "active",
        moves: [],
        lastMoveAt: new Date(),
      },
    });

    engine.postMessage("uci");
    engine.postMessage("isready");

    // If player is black, Stockfish should move first
    if (playerColor === "black") {
      // Stockfish is white, so move first
      const { game } = this.activeGames.get(gameId);
      const bestMove = await this.getBestMove(engine, game.chess.fen(), level);
      if (bestMove) {
        game.chess.move(bestMove, { sloppy: true });
        game.moves.push(bestMove);
        game.lastMoveAt = new Date();
      }
    }

    res.status(201).json({
      gameId,
      fen: chess.fen(),
      playerColor,
    });
  }

  async submitMove(req, res) {
    const gameId = req.params.id;
    const { move } = req.body;
    const activeGame = this.activeGames.get(gameId);

    if (!activeGame) return res.status(404).json({ error: "Game not found" });

    const { engine, game } = activeGame;

    if (!this.validateMoveFormat(move)) {
      return res.status(400).json({ error: "Invalid move format" });
    }

    try {
      game.chess.move(move, { sloppy: true });
      game.moves.push(move);

      const bestMove = await this.getBestMove(
        engine,
        game.chess.fen(),
        game.stockfishLevel
      );
      if (bestMove) {
        game.chess.move(bestMove, { sloppy: true });
        game.moves.push(bestMove);
      }

      res.json({
        fen: game.chess.fen(),
        moves: game.moves,
        stockfishReply: bestMove,
      });
    } catch (err) {
      console.error("Move failed:", err);
      res.status(400).json({ error: "Illegal move" });
    }
  }

  async getBestMove(engine, fen, level) {
    return new Promise((resolve) => {
      const handler = (msg) => {
        if (msg.startsWith("bestmove")) {
          const move = msg.split(" ")[1];
          engine.removeMessageListener(handler);
          resolve(move);
        }
      };

      engine.addMessageListener(handler);
      engine.postMessage(`position fen ${fen}`);
      engine.postMessage(`go depth ${Math.min(22, 5 + level)}`);
    });
  }

  getGameState(req, res) {
    const activeGame = this.activeGames.get(req.params.id);
    if (!activeGame) return res.status(404).json({ error: "Game not found" });

    const { game } = activeGame;
    res.json({
      status: game.status,
      fen: game.chess.fen(),
      moves: game.moves,
      lastMoveAt: game.lastMoveAt,
    });
  }

  validateMoveFormat(move) {
    return typeof move === "string" && /^[a-h][1-8][a-h][1-8]$/.test(move);
  }

  async makeStockfishMove(gameId) {
    const activeGame = this.activeGames.get(gameId);
    if (!activeGame) return;

    const { engine, game } = activeGame;

    const bestMove = await this.getBestMove(
      engine,
      game.chess.fen(),
      game.stockfishLevel
    );
    if (bestMove) {
      game.chess.move(bestMove, { sloppy: true });
      game.moves.push(bestMove);
      game.lastMoveAt = new Date();
    }
  }

  start(port = 3000) {
    this.app.listen(port, () =>
      console.log(`✅ Chess server running on http://localhost:${port}`)
    );
  }
}

new ChessServer().start();
