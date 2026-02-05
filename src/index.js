import express from "express";
import cors from "cors";
import { Chess } from "chess.js";
import { createStockfishEngine } from "./engine.js";
import fs from "fs";

// Configuration du logging
const logStream = fs.createWriteStream("./server.log", { flags: "a" });
const errorStream = fs.createWriteStream("./server-error.log", { flags: "a" });

const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}${data ? ": " + JSON.stringify(data) : ""}\n`;
  logStream.write(logMessage);
  console.log(logMessage.trim());
};

const logError = (error, context = "") => {
  const timestamp = new Date().toISOString();
  const errorMessage = `[${timestamp}] ERREUR${context ? " (" + context + ")" : ""}: ${error.message}\nStack: ${error.stack}\n`;
  errorStream.write(errorMessage);
  console.error(errorMessage.trim());
};

class ChessServer {
  constructor() {
    this.app = express();
    this.activeGames = new Map();
    this.cleanupInterval = null;
    this.gameTimeoutMs = 30 * 60 * 1000; // 30 minutes
    this.initMiddleware();
    this.initRoutes();
    this.startCleanup();

    log("Serveur Chess initialisé");
  }

  initMiddleware() {
    this.app.use(
      cors({
        origin: "*", // À restreindre en production
        methods: ["GET", "POST"],
        allowedHeaders: ["Content-Type"],
      }),
    );

    this.app.use(express.json({ limit: "10mb" }));

    // Logging des requêtes
    this.app.use((req, res, next) => {
      const start = Date.now();

      res.on("finish", () => {
        const duration = Date.now() - start;
        log(`${req.method} ${req.url} - ${res.statusCode} - ${duration}ms`);
      });

      next();
    });

    // Gestion des erreurs globales
    this.app.use((err, req, res, next) => {
      logError(err, "Middleware global");
      res.status(500).json({
        error: "Erreur interne du serveur",
        details:
          process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    });
  }

  initRoutes() {
    // Route de santé
    this.app.get("/health", (req, res) => {
      const gamesCount = this.activeGames.size;
      const memoryUsage = process.memoryUsage();

      res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        games: gamesCount,
        uptime: process.uptime(),
        memory: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024) + "MB",
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + "MB",
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + "MB",
        },
      });
    });

    // Créer une nouvelle partie
    this.app.post("/api/games", this.createGame.bind(this));

    // Jouer un coup
    this.app.post("/api/games/:id/moves", this.submitMove.bind(this));

    // Obtenir l'état d'une partie
    this.app.get("/api/games/:id", this.getGameState.bind(this));

    // Route pour déboguer (à retirer en production)
    this.app.get("/api/debug", (req, res) => {
      res.json({
        games: Array.from(this.activeGames.entries()).map(([id, game]) => ({
          id,
          playerColor: game.playerColor,
          movesCount: game.moves.length,
          lastMoveAt: game.lastMoveAt,
          isEngineAlive: game.engine.isAlive
            ? game.engine.isAlive()
            : "unknown",
        })),
      });
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({ error: "Route non trouvée" });
    });
  }

  async createGame(req, res) {
    const startTime = Date.now();

    try {
      const { playerColor = "white", level = 5 } = req.body;

      log("Création d'une nouvelle partie", { playerColor, level });

      // Valider les paramètres
      if (!["white", "black"].includes(playerColor)) {
        return res
          .status(400)
          .json({ error: "playerColor doit être 'white' ou 'black'" });
      }

      const validatedLevel = Math.max(1, Math.min(20, parseInt(level) || 5));

      // Créer le moteur Stockfish
      const engine = createStockfishEngine();

      try {
        // Initialiser le moteur
        await engine.initialize();
        log("Stockfish initialisé avec succès");
      } catch (engineError) {
        logError(engineError, "Initialisation Stockfish");
        return res.status(500).json({
          error: "Échec de l'initialisation du moteur d'échecs",
          details: "Stockfish n'a pas pu démarrer",
        });
      }

      // Créer la partie
      const gameId = `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const chess = new Chess();

      const game = {
        chess,
        playerColor,
        stockfishLevel: validatedLevel,
        status: "active",
        moves: [],
        lastMoveAt: new Date(),
        engine,
        createdAt: new Date(),
      };

      this.activeGames.set(gameId, game);
      log(`Partie créée: ${gameId}`);

      // Si le joueur est noir, Stockfish joue le premier coup
      if (playerColor === "black") {
        log(`Le joueur est noir, Stockfish joue le premier coup...`);

        try {
          const bestMove = await this.getBestMove(
            engine,
            chess.fen(),
            validatedLevel,
          );

          if (bestMove && bestMove !== "(none)" && bestMove !== "none") {
            const sfMove = chess.move(bestMove, { sloppy: true });
            if (sfMove) {
              game.moves.push(sfMove.san);
              game.lastMoveAt = new Date();
              log(`Stockfish a joué: ${sfMove.san}`);
            } else {
              log(`Coup invalide de Stockfish: ${bestMove}`);
            }
          } else {
            log(`Stockfish n'a pas retourné de coup valide: ${bestMove}`);
          }
        } catch (moveError) {
          logError(moveError, "Premier coup Stockfish");
          // Continuer quand même, la partie peut être jouée manuellement
        }
      }

      const duration = Date.now() - startTime;
      log(`Partie ${gameId} créée en ${duration}ms`);

      res.status(201).json({
        gameId,
        fen: chess.fen(),
        playerColor,
        stockfishLevel: validatedLevel,
        moves: game.moves,
        durationMs: duration,
      });
    } catch (error) {
      logError(error, "Création de partie");
      res.status(500).json({
        error: "Échec de la création de la partie",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }

  async submitMove(req, res) {
    const startTime = Date.now();
    const gameId = req.params.id;

    try {
      const { move } = req.body;

      log(`Coup reçu pour ${gameId}: ${move}`);

      if (!move || typeof move !== "string") {
        return res
          .status(400)
          .json({
            error: "Le coup est requis et doit être une chaîne de caractères",
          });
      }

      const activeGame = this.activeGames.get(gameId);
      if (!activeGame) {
        return res.status(404).json({ error: "Partie non trouvée" });
      }

      const { chess, engine, stockfishLevel } = activeGame;

      // Valider et jouer le coup du joueur
      if (!this.validateMoveFormat(move)) {
        return res.status(400).json({ error: "Format de coup invalide" });
      }

      try {
        const userMove = chess.move(move, { sloppy: true });
        if (!userMove) {
          return res.status(400).json({ error: "Coup illégal" });
        }

        activeGame.moves.push(userMove.san);
        activeGame.lastMoveAt = new Date();
        log(`Coup valide: ${userMove.san}`);

        // Vérifier si la partie est terminée
        if (chess.isGameOver()) {
          activeGame.status = "finished";
          const result = {
            fen: chess.fen(),
            moves: activeGame.moves,
            gameOver: true,
            result: chess.isDraw()
              ? "draw"
              : chess.turn() === "w"
                ? "black_wins"
                : "white_wins",
            checkmate: chess.isCheckmate(),
            stalemate: chess.isStalemate(),
            insufficientMaterial: chess.isInsufficientMaterial(),
            threefoldRepetition: chess.isThreefoldRepetition(),
          };

          // Nettoyer le moteur
          engine.terminate();

          const duration = Date.now() - startTime;
          return res.json({
            ...result,
            durationMs: duration,
          });
        }

        // Stockfish joue son coup
        let stockfishResponse = null;
        try {
          const bestMove = await this.getBestMove(
            engine,
            chess.fen(),
            stockfishLevel,
          );

          if (bestMove && bestMove !== "(none)" && bestMove !== "none") {
            const sfMove = chess.move(bestMove, { sloppy: true });
            if (sfMove) {
              activeGame.moves.push(sfMove.san);
              activeGame.lastMoveAt = new Date();
              stockfishResponse = sfMove.san;
              log(`Stockfish a répondu: ${sfMove.san}`);

              // Vérifier si la partie est terminée après le coup de Stockfish
              if (chess.isGameOver()) {
                activeGame.status = "finished";
                engine.terminate();
              }
            }
          }
        } catch (sfError) {
          logError(sfError, "Coup Stockfish");
          // Continuer même si Stockfish échoue
        }

        const duration = Date.now() - startTime;
        res.json({
          fen: chess.fen(),
          moves: activeGame.moves,
          stockfishReply: stockfishResponse,
          gameOver: chess.isGameOver(),
          durationMs: duration,
        });
      } catch (moveError) {
        logError(moveError, "Validation du coup");
        return res.status(400).json({ error: "Coup invalide" });
      }
    } catch (error) {
      logError(error, `Soumission de coup pour ${gameId}`);
      res.status(500).json({
        error: "Échec du traitement du coup",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }

  async getBestMove(engine, fen, level) {
    return new Promise((resolve, reject) => {
      const timeout = 10000; // 10 secondes max
      let timeoutId = null;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        engine.removeMessageListener(messageHandler);
      };

      const messageHandler = (msg) => {
        if (msg.startsWith("bestmove")) {
          cleanup();
          const move = msg.split(" ")[1];
          resolve(move);
        } else if (msg.includes("error") || msg.includes("Error")) {
          cleanup();
          reject(new Error(`Stockfish error: ${msg}`));
        }
      };

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout du moteur Stockfish"));
      }, timeout);

      engine.addMessageListener(messageHandler);

      // Configurer le moteur
      engine
        .postMessage(`position fen ${fen}`)
        .then(() =>
          engine.postMessage(`setoption name Skill Level value ${level}`),
        )
        .then(() => engine.postMessage(`go movetime 2000`)) // 2 secondes max
        .catch(reject);
    });
  }

  getGameState(req, res) {
    const gameId = req.params.id;
    const activeGame = this.activeGames.get(gameId);

    if (!activeGame) {
      return res.status(404).json({ error: "Partie non trouvée" });
    }

    const { chess, status, moves, lastMoveAt, playerColor, stockfishLevel } =
      activeGame;

    res.json({
      gameId,
      status,
      fen: chess.fen(),
      moves,
      lastMoveAt,
      playerColor,
      stockfishLevel,
      turn: chess.turn(),
      gameOver: chess.isGameOver(),
      isCheck: chess.isCheck(),
      isCheckmate: chess.isCheckmate(),
      isDraw: chess.isDraw(),
      isStalemate: chess.isStalemate(),
      inCheck: chess.isCheck(),
    });
  }

  validateMoveFormat(move) {
    // Validation simplifiée des coups d'échecs
    if (typeof move !== "string") return false;

    // Accepter les roques
    if (move === "O-O" || move === "O-O-O") return true;

    // Expression régulière pour les coups d'échecs standard
    const moveRegex =
      /^([NBRQK]?)([a-h]?)([1-8]?)(x?)([a-h][1-8])(=[NBRQ])?[+#]?$/;
    return moveRegex.test(move);
  }

  startCleanup() {
    // Nettoyer les vieilles parties toutes les minutes
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;

      for (const [gameId, game] of this.activeGames.entries()) {
        const inactiveTime = now - game.lastMoveAt;

        if (inactiveTime > this.gameTimeoutMs) {
          log(
            `Nettoyage de la partie inactive: ${gameId} (${Math.round(inactiveTime / 1000)}s d'inactivité)`,
          );

          try {
            game.engine.terminate();
          } catch (err) {
            // Ignorer les erreurs de terminaison
          }

          this.activeGames.delete(gameId);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        log(`Nettoyage terminé: ${cleaned} parties supprimées`);
      }
    }, 60000); // Toutes les minutes
  }

  start(port = 3002) {
    const server = this.app.listen(port, "0.0.0.0", () => {
      log(`✅ Serveur d'échecs démarré sur le port ${port}`);
      log(`URL de santé: http://localhost:${port}/health`);
      log(`Nombre de parties actives: ${this.activeGames.size}`);
      log(`Timeout des parties: ${this.gameTimeoutMs / 1000 / 60} minutes`);
    });

    // Gestion propre des signaux d'arrêt
    const shutdown = (signal) => {
      return () => {
        log(`Signal ${signal} reçu, arrêt en cours...`);

        // Arrêter le nettoyage
        if (this.cleanupInterval) {
          clearInterval(this.cleanupInterval);
        }

        // Arrêter tous les moteurs Stockfish
        let enginesStopped = 0;
        for (const [gameId, game] of this.activeGames.entries()) {
          try {
            game.engine.terminate();
            enginesStopped++;
          } catch (err) {
            logError(err, `Arrêt engine ${gameId}`);
          }
        }

        log(`${enginesStopped} moteurs Stockfish arrêtés`);

        // Fermer le serveur
        server.close(() => {
          log("Serveur arrêté proprement");
          logStream.end();
          errorStream.end();
          process.exit(0);
        });

        // Timeout forcé après 5 secondes
        setTimeout(() => {
          log("Arrêt forcé après timeout");
          process.exit(1);
        }, 5000);
      };
    };

    process.on("SIGINT", shutdown("SIGINT"));
    process.on("SIGTERM", shutdown("SIGTERM"));

    // Gestion des erreurs non capturées
    process.on("uncaughtException", (error) => {
      logError(error, "Exception non capturée");
    });

    process.on("unhandledRejection", (reason, promise) => {
      logError(new Error(`Rejet non géré: ${reason}`), "Rejet de promesse");
    });

    return server;
  }
}

// Démarrer le serveur
try {
  new ChessServer().start();
} catch (error) {
  logError(error, "Démarrage du serveur");
  process.exit(1);
}
