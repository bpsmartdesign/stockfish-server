import { Chess } from "chess.js";

export type PieceType =
  | "pawn"
  | "knight"
  | "bishop"
  | "rook"
  | "queen"
  | "king";
export type Color = "white" | "black";
export type GameStatus =
  | "waiting"
  | "active"
  | "checkmate"
  | "draw"
  | "resigned";

export interface Game {
  id: string;
  chess: Chess;
  playerColor: Color;
  stockfishLevel: number;
  status: GameStatus;
  moves: string[];
  vibrationSequence?: number[];
  lastMoveAt: Date;
}
