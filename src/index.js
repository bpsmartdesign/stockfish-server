import express from "express";
import cors from "cors";
import stockfish from "stockfish.js";
import { Chess } from "chess.js";

const FILE_VIBRATIONS = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
const RANK_VIBRATIONS = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8 };
const PIECE_VIBRATIONS = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };
const PAUSE_DURATION = 4000;

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
    const { playerColor = "white", level = 2 } = req.body;

    try {
      const engine = stockfish();
      const gameId = Date.now().toString();
      const game = {
        chess: new Chess(),
        playerColor,
        stockfishLevel: Math.max(1, Math.min(20, level)),
        status: "waiting",
        moves: [],
        lastMoveAt: new Date(),
        vibrationSequence: null,
      };

      this.activeGames.set(gameId, { engine, game });

      engine.onmessage = (msg) =>
        typeof msg === "string" && console.debug(`[${gameId}] Engine: ${msg}`);

      engine.postMessage("uci");
      engine.postMessage("isready");

      if (playerColor === "black") {
        setTimeout(() => this.makeStockfishMove(gameId), 500);
      }

      res.status(201).json({
        gameId,
        fen: game.chess.fen(),
        playerColor,
        stockfishLevel: game.stockfishLevel,
      });
    } catch (err) {
      console.error("Engine init failed:", err);
      res.status(500).json({ error: "Engine initialization failed" });
    }
  }

  async submitMove(req, res) {
    const gameId = req.params.id;
    const activeGame = this.activeGames.get(gameId);

    if (!activeGame) {
      return res.status(404).json({ error: "Game not found" });
    }

    const { engine, game } = activeGame;
    const { move } = req.body;

    if (!this.validateMove(move)) {
      return res.status(400).json({ error: "Invalid move format" });
    }

    try {
      game.vibrationSequence = this.convertMoveToVibration(move, game.chess);
      game.chess.move(move);
      game.moves.push(move);
      this.updateGameStatus(game);

      if (game.status === "active") {
        await this.makeStockfishMove(gameId);
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
  }

  getGameState(req, res) {
    const activeGame = this.activeGames.get(req.params.id);
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
  }

  async makeStockfishMove(gameId) {
    const activeGame = this.activeGames.get(gameId);
    if (!activeGame || activeGame.game.status !== "active") return;

    const { engine, game } = activeGame;

    return new Promise((resolve) => {
      engine.onmessage = (msg) => {
        if (typeof msg === "string" && msg.includes("bestmove")) {
          const move = msg.match(/bestmove (\w+)/)?.[1];
          if (move) {
            try {
              game.vibrationSequence = this.convertMoveToVibration(
                move,
                game.chess
              );
              game.chess.move(move);
              game.moves.push(move);
              this.updateGameStatus(game);
            } catch (err) {
              console.error("Error processing move:", err);
            }
          }
          resolve();
        }
      };

      engine.postMessage(`position fen ${game.chess.fen()}`);
      engine.postMessage(`go depth ${Math.min(22, 5 + game.stockfishLevel)}`);
    });
  }

  validateMove(move) {
    return typeof move === "string" && /^[a-h][1-8][a-h][1-8]$/.test(move);
  }

  updateGameStatus(game) {
    if (game.chess.isGameOver()) {
      game.status = game.chess.isCheckmate()
        ? game.chess.turn() === game.playerColor
          ? "lost"
          : "won"
        : "draw";
    } else {
      game.status = "active";
    }
    game.lastMoveAt = new Date();
  }

  convertMoveToVibration(move, chess) {
    const moveObj = chess.move(move, { sloppy: true });
    if (!moveObj) return [];

    const components = [];
    const tempChess = new Chess(chess.fen());
    tempChess.move(move);

    const ambiguousPieces = tempChess
      .board()
      .flat()
      .filter((sq) => {
        return sq && sq.type === moveObj.piece && sq.color === moveObj.color;
      });

    if (ambiguousPieces.length > 1) {
      components.push(7); // disambiguation
      components.push(FILE_VIBRATIONS[moveObj.from[0]]);
      components.push(RANK_VIBRATIONS[moveObj.from[1]]);
    }

    components.push(
      PIECE_VIBRATIONS[moveObj.piece],
      FILE_VIBRATIONS[moveObj.to[0]],
      RANK_VIBRATIONS[moveObj.to[1]]
    );

    return components.flatMap((vibrations, i) => {
      return Array(vibrations)
        .fill()
        .flatMap((_, j) => [
          500,
          j < vibrations - 1
            ? 100
            : i < components.length - 1
            ? PAUSE_DURATION
            : 0,
        ]);
    });
  }

  start(port = 3000) {
    setInterval(() => {
      const oneHourAgo = new Date(Date.now() - 3600000);
      this.activeGames.forEach(({ engine, game }, gameId) => {
        if (game.lastMoveAt < oneHourAgo) {
          engine.terminate?.(); // prevent crash if terminate is not defined
          this.activeGames.delete(gameId);
        }
      });
    }, 3600000);

    this.app.listen(port, () =>
      console.log(`✅ Chess server running at http://localhost:${port}`)
    );
  }
}

new ChessServer().start();
