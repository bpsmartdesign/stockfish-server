import { Game } from "../types/app";

export function convertMoveToVibration(move: string): number[] {
  const pieceMap: Record<string, number> = {
    p: 1,
    n: 2,
    b: 3,
    r: 4,
    q: 5,
    k: 6,
  };

  const toSquare = move.slice(2, 4); // "f3" from "g1f3"
  const pieceChar = move.length > 4 ? move[4].toLowerCase() : "p";

  return [
    pieceMap[pieceChar] || 1, // Piece type
    toSquare.charCodeAt(0) - 96, // File (a=1, h=8)
    parseInt(toSquare[1]), // Rank (1-8)
  ];
}

export function validateMove(move: string): boolean {
  return /^[a-h][1-8][a-h][1-8][nbrq]?$/.test(move);
}

export function updateGameStatus(game: Game): void {
  if (game.chess.isCheckmate()) {
    game.status = "checkmate";
  } else if (game.chess.isDraw()) {
    game.status = "draw";
  } else if (game.chess.isCheck()) {
    game.status = "active"; // Still in check
  } else {
    game.status = "active";
  }
  game.lastMoveAt = new Date();
}
