import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { WebSocket, WebSocketServer } from 'ws';
import { openDatabase, type Query } from './db.ts';

const db = await openDatabase();

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
  rating?: number;
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
// Render terminates TLS in a proxy; without this every player shares one rate-limit bucket
if (process.env.RENDER) app.set('trust proxy', 1);
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

async function ratingFor(userId: string, query: Query = db.query): Promise<RatingRow> {
  const season = currentSeason();
  const now = Date.now();
  await query(
    `INSERT INTO pvp_ratings (user_id, rating, season_key, season_rating, updated_at)
     VALUES ($1, 1000, $2, 1000, $3)
     ON CONFLICT(user_id) DO NOTHING`,
    [userId, season, now],
  );
  const [row] = await query<RatingRow>('SELECT rating, season_key, season_rating FROM pvp_ratings WHERE user_id = $1', [userId]);
  if (!row) throw new Error('Rating row is missing.');
  if (row.season_key !== season) {
    await query('UPDATE pvp_ratings SET season_key = $1, season_rating = 1000, updated_at = $2 WHERE user_id = $3', [season, now, userId]);
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

async function issueSession(user: User): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const ttlDays = Math.min(90, Math.max(1, Number(process.env.SESSION_TTL_DAYS) || 30));
  await db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
    hashToken(token),
    user.id,
    Date.now() + ttlDays * 86_400_000,
  ]);
  return token;
}

async function getUser(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const [row] = await db.query<User>(
    `SELECT users.id, users.username
     FROM sessions JOIN users ON sessions.user_id = users.id
     WHERE sessions.token_hash = $1 AND sessions.expires_at > $2`,
    [hashToken(token), Date.now()],
  );
  return row ?? null;
}

function bearerToken(req: Request): string | undefined {
  return /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.header('authorization') ?? '')?.[1];
}

async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await getUser(bearerToken(req));
  if (!user) {
    res.status(401).json({ error: 'Sign in to use this feature.' });
    return;
  }
  res.locals.user = user;
  next();
}

async function authResponse(res: Response, user: User): Promise<void> {
  res.json({ token: await issueSession(user), user: { id: user.id, username: user.username } });
}

app.get('/api/health', async (_req, res) => {
  await db.query('SELECT 1');
  res.json({ ok: true });
});

app.post('/api/auth/register', limitAuth, async (req, res) => {
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
    await db.tx(async (query) => {
      await query('INSERT INTO users (id, username, salt, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)', [
        id,
        username,
        salt,
        scryptSync(password, salt, 64).toString('hex'),
        Date.now(),
      ]);
      await query('INSERT INTO player_stats (user_id) VALUES ($1)', [id]);
      await ratingFor(id, query);
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'That username is already taken.' });
      return;
    }
    throw error;
  }
  await authResponse(res, { id, username });
});

app.post('/api/auth/login', limitAuth, async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const [row] = await db.query<User & { salt: string; password_hash: string }>(
    'SELECT id, username, salt, password_hash FROM users WHERE username = $1',
    [username],
  );
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
  await authResponse(res, row);
});

app.post('/api/auth/logout', requireUser, async (req, res) => {
  const token = bearerToken(req);
  if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  res.sendStatus(204);
});

app.get('/api/me', requireUser, (_req, res) => res.json({ user: res.locals.user as User }));

function isPlainObject(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSavePayload(value: unknown): value is SavePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const save = value as Record<string, unknown>;
  return (
    (save.v === 1 || save.v === 2 || save.v === 3 || save.v === 4 || save.v === 5) &&
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
    ((save.v !== 4 && save.v !== 5) ||
      (Array.isArray(save.discoveries) &&
        save.discoveries.length <= 100 &&
        save.discoveries.every((id) => typeof id === 'string' && /^[a-z0-9-]{1,48}$/.test(id)))) &&
    // the client repairs the contents, so only the shapes are checked here
    (save.v !== 5 || (isPlainObject(save.company) && (save.run === null || isPlainObject(save.run))))
  );
}

app.get('/api/save', requireUser, async (_req, res) => {
  const user = res.locals.user as User;
  const [row] = await db.query<SaveRow>('SELECT payload, revision, updated_at FROM saves WHERE user_id = $1', [user.id]);
  if (!row) {
    res.status(404).json({ error: 'No cloud save exists for this account.' });
    return;
  }
  res.json({ save: JSON.parse(row.payload), revision: row.revision, updatedAt: row.updated_at });
});

app.put('/api/save', requireUser, async (req, res) => {
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
  const now = Date.now();
  const payload = JSON.stringify(save);
  // single statements, so two devices saving at once cannot both win
  const [written] =
    revision === 0
      ? await db.query<{ revision: number }>(
          'INSERT INTO saves (user_id, payload, revision, updated_at) VALUES ($1, $2, 1, $3) ON CONFLICT(user_id) DO NOTHING RETURNING revision',
          [user.id, payload, now],
        )
      : await db.query<{ revision: number }>(
          'UPDATE saves SET payload = $2, revision = revision + 1, updated_at = $3 WHERE user_id = $1 AND revision = $4 RETURNING revision',
          [user.id, payload, now, revision],
        );
  if (!written) {
    const [current] = await db.query<{ revision: number }>('SELECT revision FROM saves WHERE user_id = $1', [user.id]);
    res.status(409).json({ error: 'Cloud save changed on another device.', revision: current?.revision ?? 0 });
    return;
  }
  res.json({ revision: written.revision, updatedAt: now });
});

app.get('/api/pvp/stats', requireUser, async (_req, res) => {
  const user = res.locals.user as User;
  const [stats] = await db.query<{ wins: number; losses: number }>('SELECT wins, losses FROM player_stats WHERE user_id = $1', [user.id]);
  const rating = await ratingFor(user.id);
  res.json({ ...(stats ?? { wins: 0, losses: 0 }), rating: rating.rating, seasonRating: rating.season_rating, season: rating.season_key });
});

app.get('/api/pvp/leaderboard', requireUser, async (_req, res) => {
  const season = currentSeason();
  const rows = await db.query<{ username: string; rating: number }>(
    `SELECT users.username, pvp_ratings.season_rating AS rating
     FROM pvp_ratings JOIN users ON users.id = pvp_ratings.user_id
     WHERE pvp_ratings.season_key = $1
     ORDER BY pvp_ratings.season_rating DESC, pvp_ratings.updated_at ASC
     LIMIT 20`,
    [season],
  );
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

function report(error: unknown): void {
  console.error('Backend task failed.', error);
}

function send(socket: WebSocket, data: object): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
}

async function recordMatchResult(match: Match, winner: Combatant, loser: Combatant): Promise<{ duration: number; ratingChange: number }> {
  const duration = Math.max(1, Math.floor((Date.now() - match.startedAt) / 1000));
  let ratingChange = 0;
  await db.tx(async (query) => {
    if (match.ranked) {
      const winnerRating = await ratingFor(winner.id, query);
      const loserRating = await ratingFor(loser.id, query);
      const expected = 1 / (1 + Math.pow(10, (loserRating.season_rating - winnerRating.season_rating) / 400));
      ratingChange = Math.max(1, Math.round(32 * (1 - expected)));
      const update = 'UPDATE pvp_ratings SET rating = $1, season_rating = $2, updated_at = $3 WHERE user_id = $4';
      await query(update, [
        Math.max(100, winnerRating.rating + ratingChange),
        Math.max(100, winnerRating.season_rating + ratingChange),
        Date.now(),
        winner.id,
      ]);
      await query(update, [
        Math.max(100, loserRating.rating - ratingChange),
        Math.max(100, loserRating.season_rating - ratingChange),
        Date.now(),
        loser.id,
      ]);
    }
    await query(
      `INSERT INTO matches (id, winner_id, loser_id, duration_seconds, created_at, ranked, winner_rating_delta, loser_rating_delta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [match.id, winner.id, loser.id, duration, Date.now(), Number(match.ranked), ratingChange, -ratingChange],
    );
    await query('UPDATE player_stats SET wins = wins + 1 WHERE user_id = $1', [winner.id]);
    await query('UPDATE player_stats SET losses = losses + 1 WHERE user_id = $1', [loser.id]);
  });
  return { duration, ratingChange };
}

async function cleanSocket(socket: ClientSocket): Promise<void> {
  const waitingIndex = waiting.indexOf(socket);
  if (waitingIndex >= 0) waiting.splice(waitingIndex, 1);
  socket.queued = false;
  if (!socket.matchId) return;
  const match = matches.get(socket.matchId);
  if (!match || match.ended) return;
  const other = match.players.find((player) => player.socket !== socket);
  const quitter = match.players.find((player) => player.socket === socket);
  // close the match before awaiting, so nothing else can finish it twice
  match.ended = true;
  matches.delete(match.id);
  socket.matchId = undefined;
  if (other) other.socket.matchId = undefined;
  if (other && quitter) {
    const result = await recordMatchResult(match, other, quitter);
    send(other.socket, {
      type: 'match-ended',
      reason: 'opponent-disconnected',
      winner: other.id,
      duration: result.duration,
      ranked: match.ranked,
      ratingChange: result.ratingChange,
    });
  }
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
  const firstRating = ranked ? (first.rating ?? 1000) : null;
  const secondRating = ranked ? (second.rating ?? 1000) : null;
  send(first, { type: 'match-found', matchId: id, playerId: one.id, opponent: two.username, world: WORLD, ranked, rating: firstRating, opponentRating: secondRating });
  send(second, { type: 'match-found', matchId: id, playerId: two.id, opponent: one.username, world: WORLD, ranked, rating: secondRating, opponentRating: firstRating });
}

async function finishMatch(match: Match, winner: Combatant, reason: string): Promise<void> {
  if (match.ended) return;
  match.ended = true;
  matches.delete(match.id);
  const loser = match.players.find((player) => player !== winner);
  if (!loser) return;
  for (const player of match.players) player.socket.matchId = undefined;
  const result = await recordMatchResult(match, winner, loser);
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
  }
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
        finishMatch(match, shot.owner === a.id ? a : b, 'destroyed').catch(report);
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

async function handleMessage(socket: ClientSocket, raw: string): Promise<void> {
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
    const user = await getUser(message.token);
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
    // look the rating up first: the search and enqueue below must run without an await between them
    const playerRating = ranked ? (await ratingFor(socket.user.id)).season_rating : 0;
    socket.rating = playerRating;
    const opponentIndex = waiting.findIndex((entry) => {
      if (entry === socket || entry.user?.id === socket.user?.id || entry.readyState !== WebSocket.OPEN || entry.ranked !== ranked) return false;
      if (!ranked) return true;
      const opponentRating = entry.rating ?? 1000;
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
    await cleanSocket(socket);
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
  // one message at a time per socket, so a queue request cannot overtake authentication
  let tail: Promise<void> = Promise.resolve();
  const then = (task: () => Promise<void>): void => {
    tail = tail.then(task).catch(report);
  };
  socket.on('message', (data) =>
    then(async () => {
      await handleMessage(socket, data.toString());
      if (socket.user) clearTimeout(authTimer);
    }),
  );
  socket.on('close', () => {
    clearTimeout(authTimer);
    then(() => cleanSocket(socket));
  });
  socket.on('error', report);
});

setInterval(() => {
  for (const match of matches.values()) updateMatch(match);
}, STEP * 1000);

function shutdown(): void {
  for (const socket of wss.clients) socket.close(1001, 'server-shutdown');
  server.close(() => {
    db.close().finally(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
