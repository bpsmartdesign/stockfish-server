import request from 'supertest';
import { Chess } from 'chess.js';
import { ChessServer } from './server.js';

describe('Chess Server', () => {
  let server;
  let app;

  beforeAll(() => {
    server = new ChessServer();
    app = server.app;
    server.start(3001); // Test on different port
  });

  afterAll(() => {
    server.activeGames.forEach(({ engine }) => engine.terminate());
  });

  test('POST /api/games creates a new game', async () => {
    const res = await request(app)
      .post('/api/games')
      .send({ playerColor: 'white', level: 2 });
    
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('gameId');
    expect(res.body.fen).toBe(new Chess().fen());
  });

  test('POST /api/games/:id/moves validates moves', async () => {
    const gameRes = await request(app)
      .post('/api/games')
      .send({ playerColor: 'white' });
    
    const res = await request(app)
      .post(`/api/games/${gameRes.body.gameId}/moves`)
      .send({ move: 'invalid' });
    
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid move format');
  });

  test('Stockfish responds to moves', async () => {
    const gameRes = await request(app)
      .post('/api/games')
      .send({ playerColor: 'white' });
    
    await request(app)
      .post(`/api/games/${gameRes.body.gameId}/moves`)
      .send({ move: 'e2e4' });
    
    const stateRes = await request(app)
      .get(`/api/games/${gameRes.body.gameId}`);
    
    expect(stateRes.body.moves.length).toBe(2); // Player + Stockfish move
    expect(stateRes.body.vibrationSequence).toBeInstanceOf(Array);
  });

  test('Vibration patterns match chess rules', () => {
  const chess = new Chess();
  const server = new ChessServer();
  
  // Test pawn move
  const pawnMove = server.convertMoveToVibration('e2e4', chess);
  expect(pawnMove).toEqual([
    500,    // 1 vibration (pawn)
    4000,   // Pause
    500,    // 5 vibrations (e-file)
    500, 500, 500, 500,
    4000,   // Pause
    500, 500, 500, 500 // 4 vibrations (4th rank)
  ]);

  // Test ambiguous rook move
  chess.load('4k3/8/8/8/8/8/R7/R3K3 w - - 0 1');
  const rookMove = server.convertMoveToVibration('a2a4', chess);
  expect(rookMove.slice(0, 5)).toEqual([
    500, 500, 500, 500, 500, // 7 vibrations (disambiguation marker)
    4000,
    500,    // 1 vibration (a-file)
    4000,
    500, 500 // 2 vibrations (2nd rank)
    // ... continues with piece and destination
  ]);
});
});