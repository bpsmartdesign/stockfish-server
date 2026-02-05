import express from "express";
import cors from "cors";
import { Chess } from "chess.js";
import { createStockfishEngine } from "./engine.js";

class ChessServer {
  constructor() {
    this.app = express();
    this.activeGames = new Map();
    this.cleanupInterval = null;
    this.initMiddleware();
    this.initRoutes();
    this.startCleanup();
  }

  initMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
      next();
    });
  }

  initRoutes() {
    this.app.get("/health", (req, res) => res.json({ status: "ok" }));
    this.app.post("/api/games", this.createGame.bind(this));
    this.app.post("/api/games/:id/moves", this.submitMove.bind(this));
    this.app.get("/api/games/:id", this.getGameState.bind(this));
  }

  async createGame(req, res) {
    try {
      console.log("Creating new game...");
      const { playerColor = "white", level = 5 } = req.body;

      // Créer le moteur avec timeout
      const engine = createStockfishEngine();

      // Tester Stockfish
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Stockfish timeout")),
          5000,
        );

        const handler = (msg) => {
          if (msg === "uciok" || msg.includes("Stockfish")) {
            clearTimeout(timeout);
            engine.removeMessageListener(handler);
            resolve();
          }
        };

        engine.addMessageListener(handler);
        engine.postMessage("uci");
        engine.postMessage("isready");
      });

      const gameId = Date.now().toString();
      const chess = new Chess();

      const game = {
        chess,
        playerColor,
        stockfishLevel: Math.min(Math.max(1, level), 20), // Limiter 1-20
        status: "active",
        moves: [],
        lastMoveAt: new Date(),
        engine,
      };

      this.activeGames.set(gameId, game);

      if (playerColor === "black") {
        console.log("Stockfish makes first move...");
        const bestMove = await this.getBestMove(
          engine,
          chess.fen(),
          game.stockfishLevel,
        );
        if (bestMove && bestMove !== "(none)") {
          try {
            const sfMove = chess.move(bestMove, { sloppy: true });
            if (sfMove) {
              game.moves.push(sfMove.san);
              game.lastMoveAt = new Date();
            }
          } catch (err) {
            console.error("Stockfish move failed:", err);
          }
        }
      }

      res.status(201).json({
        gameId,
        fen: chess.fen(),
        playerColor,
        moves: game.moves,
      });
    } catch (error) {
      console.error("Create game error:", error);
      res.status(500).json({
        error: "Failed to create game",
        details: error.message,
      });
    }
  }

  async getBestMove(engine, fen, level) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        engine.removeMessageListener(handler);
        reject(new Error("Stockfish timeout after 10s"));
      }, 10000);

      const handler = (msg) => {
        if (msg.startsWith("bestmove")) {
          clearTimeout(timeout);
          engine.removeMessageListener(handler);
          const move = msg.split(" ")[1];
          resolve(move);
        }
      };

      engine.addMessageListener(handler);
      engine.postMessage(`position fen ${fen}`);
      engine.postMessage(`setoption name Skill Level value ${level}`);
      engine.postMessage(`go movetime 2000`); // 2 secondes max par coup
    });
  }

  startCleanup() {
    // Nettoyer les vieilles parties toutes les 5 minutes
    this.cleanupInterval = setInterval(
      () => {
        const now = Date.now();
        for (const [gameId, game] of this.activeGames.entries()) {
          if (now - game.lastMoveAt > 30 * 60 * 1000) {
            // 30 minutes d'inactivité
            game.engine.quit();
            this.activeGames.delete(gameId);
            console.log(`Cleaned up old game: ${gameId}`);
          }
        }
      },
      5 * 60 * 1000,
    );
  }

  start(port = 3002) {
    const server = this.app.listen(port, "0.0.0.0", () => {
      console.log(`✅ Chess server running on port ${port}`);
      console.log(`Health check: http://localhost:${port}/health`);
    });

    // Gestion propre de l'arrêt
    process.on("SIGINT", () => {
      console.log("Shutting down...");
      for (const game of this.activeGames.values()) {
        game.engine.quit();
      }
      if (this.cleanupInterval) clearInterval(this.cleanupInterval);
      server.close(() => {
        console.log("Server stopped");
        process.exit(0);
      });
    });
  }
}

new ChessServer().start();
