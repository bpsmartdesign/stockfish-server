import { spawn } from "child_process";
import fs from "fs";

const logStream = fs.createWriteStream("./stockfish.log", { flags: "a" });

const log = (message, data = null) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}${data ? ": " + JSON.stringify(data) : ""}\n`;
  logStream.write(logMessage);
  console.log(logMessage.trim());
};

export function createStockfishEngine() {
  log("Création d'un moteur Stockfish");

  // Différents chemins possibles selon l'installation
  const possiblePaths = [
    "/usr/games/stockfish", // Ubuntu/Debian
    "/usr/local/bin/stockfish", // Installation manuelle
    "/usr/bin/stockfish", // Autre
    "stockfish", // Dans PATH
  ];

  let stockfishPath = null;
  for (const path of possiblePaths) {
    try {
      // Vérifier si le fichier existe et est exécutable
      fs.accessSync(path, fs.constants.X_OK);
      stockfishPath = path;
      log(`Stockfish trouvé à: ${path}`);
      break;
    } catch (err) {
      continue;
    }
  }

  if (!stockfishPath) {
    log("ERREUR: Stockfish non trouvé!");
    throw new Error(
      "Stockfish non trouvé. Installez-le avec: sudo apt install stockfish",
    );
  }

  // Options pour éviter les zombies et gérer les signaux
  const engine = spawn(stockfishPath, [], {
    stdio: ["pipe", "pipe", "pipe"],
    detached: false,
    // Ne pas hériter des descripteurs de fichiers parent
    stdio: "pipe",
  });

  // Gestionnaires d'événements pour détecter les problèmes
  engine.on("error", (err) => {
    log("Erreur de démarrage Stockfish", err.message);
    engine.emit("stockfish_error", err);
  });

  engine.on("exit", (code, signal) => {
    log(`Stockfish terminé. Code: ${code}, Signal: ${signal}`);
  });

  engine.stderr.on("data", (data) => {
    const error = data.toString().trim();
    if (error) {
      log("Stockfish stderr", error);
    }
  });

  // Buffer pour accumuler les sorties (Stockfish envoie parfois des lignes partielles)
  let buffer = "";

  // Liste des listeners
  const listeners = new Set();

  engine.stdout.on("data", (data) => {
    buffer += data.toString();

    // Découper en lignes complètes
    const lines = buffer.split("\n");

    // Garder la dernière ligne incomplète dans le buffer
    buffer = lines.pop() || "";

    lines.forEach((line) => {
      if (line.trim()) {
        const trimmedLine = line.trim();
        log("Stockfish stdout", trimmedLine);

        // Notifier tous les listeners
        listeners.forEach((listener) => {
          try {
            listener(trimmedLine);
          } catch (err) {
            log("Erreur dans un listener", err.message);
          }
        });
      }
    });
  });

  // Fonction pour envoyer une commande avec timeout
  const postMessage = (cmd, timeout = 5000) => {
    return new Promise((resolve, reject) => {
      log(`Envoi commande Stockfish: ${cmd}`);

      const timeoutId = setTimeout(() => {
        log(`Timeout commande: ${cmd}`);
        reject(new Error(`Timeout commande: ${cmd}`));
      }, timeout);

      const onError = (err) => {
        clearTimeout(timeoutId);
        reject(err);
      };

      engine.once("error", onError);

      try {
        engine.stdin.write(cmd + "\n");
        resolve();
      } catch (err) {
        clearTimeout(timeoutId);
        reject(err);
      } finally {
        engine.removeListener("error", onError);
      }
    });
  };

  return {
    postMessage: async (cmd) => {
      await postMessage(cmd);
    },

    addMessageListener: (callback) => {
      listeners.add(callback);
    },

    removeMessageListener: (callback) => {
      listeners.delete(callback);
    },

    terminate: () => {
      log("Terminaison de Stockfish");
      listeners.clear();

      // Envoyer 'quit' proprement
      try {
        engine.stdin.write("quit\n");
      } catch (err) {
        // Ignorer les erreurs d'écriture si le processus est déjà terminé
      }

      // Attendre un peu puis forcer la terminaison
      setTimeout(() => {
        try {
          if (!engine.killed) {
            engine.kill("SIGKILL");
          }
        } catch (err) {
          // Ignorer
        }
      }, 1000);
    },

    // Méthode utilitaire pour initialiser le moteur
    initialize: async () => {
      try {
        await postMessage("uci");

        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            listenerCleanup();
            reject(new Error("Timeout initialisation UCI"));
          }, 10000);

          const handler = (msg) => {
            if (msg === "uciok") {
              clearTimeout(timeout);
              listenerCleanup();
              log("Stockfish UCI initialisé");
              resolve(true);
            }
          };

          const listenerCleanup = () => {
            listeners.delete(handler);
          };

          listeners.add(handler);

          // Vérifier si déjà prêt
          postMessage("isready").catch(reject);
        });
      } catch (err) {
        log("Erreur initialisation Stockfish", err.message);
        throw err;
      }
    },

    // Méthode pour vérifier si le moteur est vivant
    isAlive: () => {
      return !engine.killed && engine.exitCode === null;
    },

    getProcessId: () => {
      return engine.pid;
    },
  };
}
