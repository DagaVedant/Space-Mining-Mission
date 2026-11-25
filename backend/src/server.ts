import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { WebSocket, WebSocketServer } from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
const databasePath = resolve(process.env.DATABASE_PATH ?? resolve(here, '../data/rockbreaker.sqlite'));
mkdirSync(dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS saves (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    payload TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS player_stats (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    winner_id TEXT NOT NULL REFERENCES users(id),
    loser_id TEXT NOT NULL REFERENCES users(id),
    duration_seconds INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    ranked INTEGER NOT NULL DEFAULT 0,
    winner_rating_delta INTEGER NOT NULL DEFAULT 0,
    loser_rating_delta INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS pvp_ratings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL DEFAULT 1000,
    season_key TEXT NOT NULL,
    season_rating INTEGER NOT NULL DEFAULT 1000,
    updated_at INTEGER NOT NULL
  );
`);

const matchColumns = new Set((db.pragma('table_info(matches)') as { name: string }[]).map((column) => column.name));
for (const [name, definition] of [
  ['ranked', 'INTEGER NOT NULL DEFAULT 0'],
  ['winner_rating_delta', 'INTEGER NOT NULL DEFAULT 0'],
  ['loser_rating_delta', 'INTEGER NOT NULL DEFAULT 0'],
] as const) {
  if (!matchColumns.has(name)) db.exec(`ALTER TABLE matches ADD COLUMN ${name} ${definition}`);
}

interface User {
  id: string;
  username: string;
}

interface SavePayload {
  v: number;
  money: number;
  lifetime: number;
  sector: number;
  sectorEarned: number;
  levels: Record<string, number>;
  won: boolean;
  [key: string]: unknown;
}

interface SaveRow {
  payload: string;
  revision: number;
  updated_at: number;
}

interface ClientSocket extends WebSocket {
  user?: User;
  queued?: boolean;
  ranked?: boolean;
  queuedAt?: number;
  matchId?: string;
}

interface InputState {
  ax: number;
  ay: number;
  aim: number;
  fire: boolean;
  boost: boolean;
}

interface Combatant {
  socket: ClientSocket;
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  hp: number;
  fireCooldown: number;
  input: InputState;
}

interface Projectile {
  owner: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

interface Match {
  id: string;
  startedAt: number;
  players: [Combatant, Combatant];
  projectiles: Projectile[];
  ended: boolean;
  ranked: boolean;
}

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '128kb' }));

const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);
app.use((req, res, next) => {
  const origin = req.header('origin');
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(origin && !allowedOrigins.has(origin) ? 403 : 204);
    return;
  }
  next();
});

const authAttempts = new Map<string, { count: number; resetAt: number }>();
function currentSeason(now = Date.now()): string {
  const date = new Date(now);
  return `${date.getUTCFullYear()}-S${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

interface RatingRow {
  rating: number;
  season_key: string;
  season_rating: number;
}

function ratingFor(userId: string): RatingRow {
  const season = currentSeason();
  const now = Date.now();
  db.prepare(`
    INSERT INTO pvp_ratings (user_id, rating, season_key, season_rating, updated_at)
    VALUES (?, 1000, ?, 1000, ?)
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId, season, now);
  const row = db.prepare('SELECT rating, season_key, season_rating FROM pvp_ratings WHERE user_id = ?')
    .get(userId) as RatingRow;
  if (row.season_key !== season) {
    db.prepare('UPDATE pvp_ratings SET season_key = ?, season_rating = 1000, updated_at = ? WHERE user_id = ?')
      .run(season, now, userId);
    return { ...row, season_key: season, season_rating: 1000 };
  }
  return row;
}
function limitAuth(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip ?? 'unknown';
  const now = Date.now();
  const entry = authAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    authAttempts.set(key, { count: 1, resetAt: now + 60_000 });
    next();
    return;
  }
  if (entry.count >= 12) {
    res.status(429).json({ error: 'Too many authentication attempts. Try again shortly.' });
    return;
  }
  entry.count += 1;
  next();
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function issueSession(user: User): string {
  const token = randomBytes(32).toString('base64url');
  const ttlDays = Math.min(90, Math.max(1, Number(process.env.SESSION_TTL_DAYS) || 30));
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), user.id, Date.now() + ttlDays * 86_400_000);
  return token;
}

function getUser(token: string | undefined): User | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT users.id, users.username
       FROM sessions JOIN users ON sessions.user_id = users.id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    )
    .get(hashToken(token), Date.now()) as User | undefined;
  return row ?? null;
}

function bearer(req: Request): User | null {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.header('authorization') ?? '');
  return getUser(match?.[1]);
}

function requireUser(req: Request, res: Response, next: NextFunction): void {
  const user = bearer(req);
  if (!user) {
    res.status(401).json({ error: 'Sign in to use this feature.' });
    return;
  }
  res.locals.user = user;
  next();
}

function authResponse(res: Response, user: User): void {
  res.json({ token: issueSession(user), user: { id: user.id, username: user.username } });
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/register', limitAuth, (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
    res.status(400).json({ error: 'Username must be 3-24 letters, numbers, or underscores.' });
    return;
  }
  if (password.length < 10 || password.length > 128) {
    res.status(400).json({ error: 'Password must be between 10 and 128 characters.' });
    return;
  }
  const salt = randomBytes(16).toString('hex');
  const id = randomBytes(16).toString('hex');
  try {
    db.prepare('INSERT INTO users (id, username, salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, username, salt, scryptSync(password, salt, 64).toString('hex'), Date.now());
    db.prepare('INSERT INTO player_stats (user_id) VALUES (?)').run(id);
    ratingFor(id);
    authResponse(res, { id, username });
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'That username is already taken.' });
      return;
    }
    throw error;
  }
});

app.post('/api/auth/login', limitAuth, (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const row = db
    .prepare('SELECT id, username, salt, password_hash FROM users WHERE username = ?')
    .get(username) as (User & { salt: string; password_hash: string }) | undefined;
  if (!row || password.length > 128) {
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }
  const candidate = scryptSync(password, row.salt, 64);
  const expected = Buffer.from(row.password_hash, 'hex');
  if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }
  authResponse(res, row);
});

app.post('/api/auth/logout', requireUser, (req, res) => {
  const token = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.header('authorization') ?? '')?.[1];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  res.sendStatus(204);
});

app.get('/api/me', requireUser, (_req, res) => res.json({ user: res.locals.user as User }));

function isSavePayload(value: unknown): value is SavePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const save = value as Record<string, unknown>;
  return (
    (save.v === 1 || save.v === 2 || save.v === 3 || save.v === 4) &&
    typeof save.money === 'number' &&
    Number.isFinite(save.money) &&
    save.money >= 0 &&
    typeof save.lifetime === 'number' &&
    Number.isFinite(save.lifetime) &&
    save.lifetime >= 0 &&
    typeof save.sector === 'number' &&
    Number.isInteger(save.sector) &&
    save.sector >= 0 &&
    save.sector < 100 &&
    typeof save.sectorEarned === 'number' &&
    Number.isFinite(save.sectorEarned) &&
    save.sectorEarned >= 0 &&
    !!save.levels &&
    typeof save.levels === 'object' &&
    !Array.isArray(save.levels) &&
    typeof save.won === 'boolean' &&
    (save.v !== 4 ||
      (Array.isArray(save.discoveries) &&
        save.discoveries.length <= 100 &&
        save.discoveries.every((id) => typeof id === 'string' && /^[a-z0-9-]{1,48}$/.test(id))))
  );
}

app.get('/api/save', requireUser, (req, res) => {
  const user = res.locals.user as User;
  const row = db.prepare('SELECT payload, revision, updated_at FROM saves WHERE user_id = ?').get(user.id) as
    | SaveRow
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'No cloud save exists for this account.' });
    return;
  }
  res.json({ save: JSON.parse(row.payload), revision: row.revision, updatedAt: row.updated_at });
});

app.put('/api/save', requireUser, (req, res) => {
  const user = res.locals.user as User;
  const { save, revision } = req.body ?? {};
  if (!isSavePayload(save) || JSON.stringify(save).length > 96_000) {
    res.status(400).json({ error: 'Save data is invalid or too large.' });
    return;
  }
  if (!Number.isInteger(revision) || revision < 0) {
    res.status(400).json({ error: 'A valid cloud revision is required.' });
    return;
  }
  const current = db.prepare('SELECT revision FROM saves WHERE user_id = ?').get(user.id) as
    | { revision: number }
    | undefined;
  const currentRevision = current?.revision ?? 0;
  if (revision !== currentRevision) {
    res.status(409).json({ error: 'Cloud save changed on another device.', revision: currentRevision });
    return;
  }
  const nextRevision = currentRevision + 1;
  const now = Date.now();
  db.prepare(`
    INSERT INTO saves (user_id, payload, revision, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload,
      revision = excluded.revision, updated_at = excluded.updated_at
  `).run(user.id, JSON.stringify(save), nextRevision, now);
  res.json({ revision: nextRevision, updatedAt: now });
});

app.get('/api/pvp/stats', requireUser, (_req, res) => {
  const user = res.locals.user as User;
  const stats = db.prepare('SELECT wins, losses FROM player_stats WHERE user_id = ?').get(user.id) as
    | { wins: number; losses: number }
    | undefined;
  const rating = ratingFor(user.id);
  res.json({ ...(stats ?? { wins: 0, losses: 0 }), rating: rating.rating, seasonRating: rating.season_rating, season: rating.season_key });
});

app.get('/api/pvp/leaderboard', requireUser, (_req, res) => {
  const season = currentSeason();
  const rows = db.prepare(`
    SELECT users.username, pvp_ratings.season_rating AS rating
    FROM pvp_ratings JOIN users ON users.id = pvp_ratings.user_id
    WHERE pvp_ratings.season_key = ?
    ORDER BY pvp_ratings.season_rating DESC, pvp_ratings.updated_at ASC
    LIMIT 20
  `).all(season) as { username: string; rating: number }[];
  res.json({ season, players: rows.map((row, index) => ({ rank: index + 1, ...row })) });
});

const server = app.listen(Number(process.env.PORT) || 3001, '0.0.0.0', () => {
  const address = server.address();
  console.log(`Asteroid Breaker backend listening on ${typeof address === 'object' && address ? address.port : 'unknown'}`);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
const waiting: ClientSocket[] = [];
const matches = new Map<string, Match>();
const WORLD = { width: 1500, height: 900 };
const STEP = 1 / 20;

function send(socket: WebSocket, data: object): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
}

function recordMatchResult(match: Match, winner: Combatant, loser: Combatant): { duration: number; ratingChange: number } {
  const duration = Math.max(1, Math.floor((Date.now() - match.startedAt) / 1000));
  let ratingChange = 0;
  const saveResult = db.transaction(() => {
    if (match.ranked) {
      const winnerRating = ratingFor(winner.id);
      const loserRating = ratingFor(loser.id);
      const expected = 1 / (1 + Math.pow(10, (loserRating.season_rating - winnerRating.season_rating) / 400));
      ratingChange = Math.max(1, Math.round(32 * (1 - expected)));
      const winnerAllTime = Math.max(100, winnerRating.rating + ratingChange);
      const loserAllTime = Math.max(100, loserRating.rating - ratingChange);
      const winnerSeason = Math.max(100, winnerRating.season_rating + ratingChange);
      const loserSeason = Math.max(100, loserRating.season_rating - ratingChange);
      db.prepare('UPDATE pvp_ratings SET rating = ?, season_rating = ?, updated_at = ? WHERE user_id = ?')
        .run(winnerAllTime, winnerSeason, Date.now(), winner.id);
      db.prepare('UPDATE pvp_ratings SET rating = ?, season_rating = ?, updated_at = ? WHERE user_id = ?')
        .run(loserAllTime, loserSeason, Date.now(), loser.id);
    }
    db.prepare(`
      INSERT INTO matches (id, winner_id, loser_id, duration_seconds, created_at, ranked, winner_rating_delta, loser_rating_delta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(match.id, winner.id, loser.id, duration, Date.now(), Number(match.ranked), ratingChange, -ratingChange);
    db.prepare('UPDATE player_stats SET wins = wins + 1 WHERE user_id = ?').run(winner.id);
    db.prepare('UPDATE player_stats SET losses = losses + 1 WHERE user_id = ?').run(loser.id);
  });
  saveResult();
  return { duration, ratingChange };
}

function cleanSocket(socket: ClientSocket): void {
  const waitingIndex = waiting.indexOf(socket);
  if (waitingIndex >= 0) waiting.splice(waitingIndex, 1);
  socket.queued = false;
  if (!socket.matchId) return;
  const match = matches.get(socket.matchId);
  if (!match || match.ended) return;
  const other = match.players.find((player) => player.socket !== socket);
  const quitter = match.players.find((player) => player.socket === socket);
  if (other && quitter) {
    const result = recordMatchResult(match, other, quitter);
    send(other.socket, {
      type: 'match-ended',
      reason: 'opponent-disconnected',
      winner: other.id,
      duration: result.duration,
      ranked: match.ranked,
      ratingChange: result.ratingChange,
    });
  }
  match.ended = true;
  matches.delete(match.id);
  socket.matchId = undefined;
  if (other) other.socket.matchId = undefined;
}

function startMatch(first: ClientSocket, second: ClientSocket, ranked: boolean): void {
  const one = first.user;
  const two = second.user;
  if (!one || !two) return;
  const id = randomBytes(12).toString('hex');
  const players: [Combatant, Combatant] = [
    { socket: first, id: one.id, name: one.username, x: 310, y: 450, vx: 0, vy: 0, rotation: 0, hp: 100, fireCooldown: 0, input: { ax: 0, ay: 0, aim: 0, fire: false, boost: false } },
    { socket: second, id: two.id, name: two.username, x: 1190, y: 450, vx: 0, vy: 0, rotation: Math.PI, hp: 100, fireCooldown: 0, input: { ax: 0, ay: 0, aim: Math.PI, fire: false, boost: false } },
  ];
  const match: Match = { id, startedAt: Date.now(), players, projectiles: [], ended: false, ranked };
  matches.set(id, match);
  first.matchId = id;
  second.matchId = id;
  first.queued = false;
  second.queued = false;
  const firstRating = ranked ? ratingFor(one.id).season_rating : null;
  const secondRating = ranked ? ratingFor(two.id).season_rating : null;
  send(first, { type: 'match-found', matchId: id, playerId: one.id, opponent: two.username, world: WORLD, ranked, rating: firstRating, opponentRating: secondRating });
  send(second, { type: 'match-found', matchId: id, playerId: two.id, opponent: one.username, world: WORLD, ranked, rating: secondRating, opponentRating: firstRating });
}

function finishMatch(match: Match, winner: Combatant, reason: string): void {
  if (match.ended) return;
  match.ended = true;
  const loser = match.players.find((player) => player !== winner);
  if (!loser) return;
  const result = recordMatchResult(match, winner, loser);
  for (const player of match.players) {
    const won = player.id === winner.id;
    send(player.socket, {
      type: 'match-ended',
      reason,
      winner: winner.id,
      duration: result.duration,
      ranked: match.ranked,
      ratingChange: match.ranked ? (won ? result.ratingChange : -result.ratingChange) : 0,
    });
    player.socket.matchId = undefined;
  }
  matches.delete(match.id);
}

function updateMatch(match: Match): void {
  if (match.ended) return;
  const [a, b] = match.players;
  for (const player of match.players) {
    const input = player.input;
    const acceleration = input.boost ? 860 : 560;
    player.vx = (player.vx + input.ax * acceleration * STEP) * 0.985;
    player.vy = (player.vy + input.ay * acceleration * STEP) * 0.985;
    const speed = Math.hypot(player.vx, player.vy);
    const maxSpeed = input.boost ? 430 : 330;
    if (speed > maxSpeed) {
      player.vx = (player.vx / speed) * maxSpeed;
      player.vy = (player.vy / speed) * maxSpeed;
    }
    player.x = Math.max(35, Math.min(WORLD.width - 35, player.x + player.vx * STEP));
    player.y = Math.max(35, Math.min(WORLD.height - 35, player.y + player.vy * STEP));
    player.rotation = input.aim;
    player.fireCooldown = Math.max(0, player.fireCooldown - STEP);
    if (input.fire && player.fireCooldown === 0) {
      player.fireCooldown = 0.28;
      match.projectiles.push({
        owner: player.id,
        x: player.x + Math.cos(player.rotation) * 26,
        y: player.y + Math.sin(player.rotation) * 26,
        vx: Math.cos(player.rotation) * 720 + player.vx * 0.3,
        vy: Math.sin(player.rotation) * 720 + player.vy * 0.3,
        life: 2,
      });
    }
  }
  for (const shot of match.projectiles) {
    shot.x += shot.vx * STEP;
    shot.y += shot.vy * STEP;
    shot.life -= STEP;
    const target = shot.owner === a.id ? b : a;
    if (Math.hypot(target.x - shot.x, target.y - shot.y) < 24) {
      target.hp -= 18;
      shot.life = 0;
      if (target.hp <= 0) {
        finishMatch(match, shot.owner === a.id ? a : b, 'destroyed');
        return;
      }
    }
  }
  match.projectiles = match.projectiles.filter((shot) => shot.life > 0);
  const snapshot = {
    type: 'snapshot',
    players: match.players.map(({ id, name, x, y, vx, vy, rotation, hp }) => ({ id, name, x, y, vx, vy, rotation, hp })),
    projectiles: match.projectiles,
  };
  for (const player of match.players) send(player.socket, snapshot);
}

function handleMessage(socket: ClientSocket, raw: string): void {
  let message: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    message = value as Record<string, unknown>;
  } catch {
    send(socket, { type: 'error', message: 'Invalid message.' });
    return;
  }
  if (!socket.user) {
    if (message.type !== 'authenticate' || typeof message.token !== 'string') {
      send(socket, { type: 'error', message: 'Authenticate before joining a match.' });
      socket.close(4001, 'authentication-required');
      return;
    }
    const user = getUser(message.token);
    if (!user) {
      send(socket, { type: 'error', message: 'Session expired. Sign in again.' });
      socket.close(4001, 'invalid-session');
      return;
    }
    socket.user = user;
    send(socket, { type: 'authenticated', username: user.username });
    return;
  }
  if (message.type === 'ping' && typeof message.sentAt === 'number' && Number.isFinite(message.sentAt)) {
    send(socket, { type: 'pong', sentAt: message.sentAt });
    return;
  }
  if (message.type === 'queue') {
    if (socket.matchId || socket.queued) return;
    const ranked = message.ranked === true;
    const playerRating = ranked ? ratingFor(socket.user.id).season_rating : 0;
    const opponentIndex = waiting.findIndex((entry) => {
      if (entry === socket || entry.user?.id === socket.user?.id || entry.readyState !== WebSocket.OPEN || entry.ranked !== ranked) return false;
      if (!ranked) return true;
      const opponentRating = entry.user ? ratingFor(entry.user.id).season_rating : 1000;
      const waitSeconds = Math.max(0, Date.now() - (entry.queuedAt ?? Date.now())) / 1000;
      const allowedGap = Math.min(800, 150 + Math.floor(waitSeconds / 10) * 100);
      return Math.abs(playerRating - opponentRating) <= allowedGap;
    });
    if (opponentIndex >= 0) {
      const opponent = waiting.splice(opponentIndex, 1)[0];
      if (opponent) startMatch(opponent, socket, ranked);
    } else {
      socket.queued = true;
      socket.ranked = ranked;
      socket.queuedAt = Date.now();
      waiting.push(socket);
      send(socket, { type: 'queued', ranked, rating: ranked ? playerRating : null, season: ranked ? currentSeason() : null });
    }
    return;
  }
  if (message.type === 'leave-queue') {
    cleanSocket(socket);
    send(socket, { type: 'queue-left' });
    return;
  }
  if (message.type === 'input' && socket.matchId) {
    const match = matches.get(socket.matchId);
    const player = match?.players.find((entry) => entry.socket === socket);
    if (!player) return;
    const ax = typeof message.ax === 'number' && Number.isFinite(message.ax) ? Math.max(-1, Math.min(1, message.ax)) : 0;
    const ay = typeof message.ay === 'number' && Number.isFinite(message.ay) ? Math.max(-1, Math.min(1, message.ay)) : 0;
    const aim = typeof message.aim === 'number' && Number.isFinite(message.aim) ? message.aim : player.rotation;
    player.input = {
      ax,
      ay,
      aim: Math.atan2(Math.sin(aim), Math.cos(aim)),
      fire: message.fire === true,
      boost: message.boost === true,
    };
  }
}

server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
});

wss.on('connection', (ws) => {
  const socket = ws as ClientSocket;
  const authTimer = setTimeout(() => {
    if (!socket.user) socket.close(4001, 'authentication-timeout');
  }, 5000);
  socket.on('message', (data) => {
    handleMessage(socket, data.toString());
    if (socket.user) clearTimeout(authTimer);
  });
  socket.on('close', () => {
    clearTimeout(authTimer);
    cleanSocket(socket);
  });
  socket.on('error', () => cleanSocket(socket));
});

setInterval(() => {
  for (const match of matches.values()) updateMatch(match);
}, STEP * 1000);

function shutdown(): void {
  for (const socket of wss.clients) socket.close(1001, 'server-shutdown');
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
