import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';

let serverProcess: ChildProcess;
let directory: string;
let baseUrl: string;
let wsUrl: string;

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to allocate a test port.');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForMessage<T extends { type: string }>(socket: WebSocket, type: string, timeoutMs = 7000): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`Timed out waiting for WebSocket message "${type}".`));
    }, timeoutMs);
    const onMessage = (data: WebSocket.RawData): void => {
      const message = JSON.parse(data.toString()) as T;
      if (message.type !== type) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(message);
    };
    socket.on('message', onMessage);
  });
}

async function register(username: string): Promise<{ token: string; user: { id: string; username: string } }> {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'space-rocks-safe-2026' }),
  });
  assert.equal(response.status, 200);
  return await response.json() as { token: string; user: { id: string; username: string } };
}

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'rockbreaker-backend-'));
  const port = await unusedPort();
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
  serverProcess = spawn(process.execPath, ['src/server.ts'], {
    cwd: join(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_PATH: join(directory, 'test.sqlite'),
      ALLOWED_ORIGINS: 'http://localhost:5173',
    },
    stdio: 'ignore',
  });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (serverProcess.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      await delay(100);
    }
  }
  assert.equal(ready, true, 'backend should start and expose its health endpoint');
});

after(async () => {
  if (serverProcess?.exitCode === null) {
    serverProcess.kill('SIGTERM');
    await new Promise<void>((resolve) => serverProcess.once('exit', () => resolve()));
  }
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test('accounts, versioned cloud saves, and authoritative PvP matches work', async () => {
  const suffix = Math.random().toString(36).slice(2, 9);
  const first = await register(`pilot_${suffix}`);
  const second = await register(`rival_${suffix}`);
  let firing: ReturnType<typeof setInterval> | undefined;

  const initialSave = {
    v: 4,
    money: 60,
    lifetime: 0,
    sector: 0,
    sectorEarned: 0,
    levels: { cannon: 0 },
    won: false,
    objectiveProgress: [0, 0, 0, 0, 0, 0],
    completedObjectives: [],
    selectedWeapon: 'miner',
    discoveries: ['kuiper-morrow-wreck'],
  };
  const saved = await fetch(`${baseUrl}/api/save`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${first.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ save: initialSave, revision: 0 }),
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json() as { revision: number }).revision, 1);
  const loadedSave = await fetch(`${baseUrl}/api/save`, {
    headers: { Authorization: `Bearer ${first.token}` },
  });
  const loadedPayload = await loadedSave.json() as { save: { v: number; discoveries: string[] } };
  assert.equal(loadedPayload.save.v, 4);
  assert.deepEqual(loadedPayload.save.discoveries, ['kuiper-morrow-wreck']);
  const invalidSave = await fetch(`${baseUrl}/api/save`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${first.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ save: { ...initialSave, discoveries: 'invalid' }, revision: 1 }),
  });
  assert.equal(invalidSave.status, 400);
  const staleWrite = await fetch(`${baseUrl}/api/save`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${first.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ save: initialSave, revision: 0 }),
  });
  assert.equal(staleWrite.status, 409);

  const one = new WebSocket(wsUrl);
  const two = new WebSocket(wsUrl);
  try {
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        one.once('open', resolve);
        one.once('error', reject);
      }),
      new Promise<void>((resolve, reject) => {
        two.once('open', resolve);
        two.once('error', reject);
      }),
    ]);
    const authOne = waitForMessage(one, 'authenticated');
    const authTwo = waitForMessage(two, 'authenticated');
    one.send(JSON.stringify({ type: 'authenticate', token: first.token }));
    two.send(JSON.stringify({ type: 'authenticate', token: second.token }));
    await Promise.all([authOne, authTwo]);
    const pong = waitForMessage<{ type: string; sentAt: number }>(one, 'pong');
    one.send(JSON.stringify({ type: 'ping', sentAt: 123 }));
    assert.equal((await pong).sentAt, 123);

    const queued = waitForMessage(one, 'queued');
    one.send(JSON.stringify({ type: 'queue', ranked: true }));
    await queued;
    const foundOne = waitForMessage<{ type: string; playerId: string }>(one, 'match-found');
    const foundTwo = waitForMessage(two, 'match-found');
    two.send(JSON.stringify({ type: 'queue', ranked: true }));
    const [matchOne] = await Promise.all([foundOne, foundTwo]);

    const result = waitForMessage<{ type: string; winner: string; ranked?: boolean; ratingChange?: number }>(one, 'match-ended', 9000);
    firing = setInterval(() => {
      if (one.readyState === WebSocket.OPEN) one.send(JSON.stringify({ type: 'input', ax: 0, ay: 0, aim: 0, fire: true }));
    }, 50);
    const ending = await result;
    clearInterval(firing);
    firing = undefined;
    assert.equal(ending.winner, matchOne.playerId);
    assert.equal(ending.ranked, true);
    assert.ok((ending.ratingChange ?? 0) > 0);
  } finally {
    if (firing) clearInterval(firing);
    one.close();
    two.close();
  }

  const stats = await fetch(`${baseUrl}/api/pvp/stats`, { headers: { Authorization: `Bearer ${first.token}` } });
  assert.equal(stats.status, 200);
  const firstStats = await stats.json() as { wins: number; rating: number; seasonRating: number };
  assert.equal(firstStats.wins, 1);
  assert.ok(firstStats.rating > 1000);
  assert.ok(firstStats.seasonRating > 1000);
  const leaderboard = await fetch(`${baseUrl}/api/pvp/leaderboard`, {
    headers: { Authorization: `Bearer ${first.token}` },
  });
  assert.equal(leaderboard.status, 200);
  assert.ok((await leaderboard.json() as { players: Array<{ username: string }> }).players.some((player) => player.username === first.user.username));

  const disconnectedPilot = await register(`quit_${suffix}`);
  const reconnect = new WebSocket(wsUrl);
  const quitter = new WebSocket(wsUrl);
  try {
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        reconnect.once('open', resolve);
        reconnect.once('error', reject);
      }),
      new Promise<void>((resolve, reject) => {
        quitter.once('open', resolve);
        quitter.once('error', reject);
      }),
    ]);
    const firstAuth = waitForMessage(reconnect, 'authenticated');
    const secondAuth = waitForMessage(quitter, 'authenticated');
    reconnect.send(JSON.stringify({ type: 'authenticate', token: first.token }));
    quitter.send(JSON.stringify({ type: 'authenticate', token: disconnectedPilot.token }));
    await Promise.all([firstAuth, secondAuth]);
    const queued = waitForMessage(reconnect, 'queued');
    reconnect.send(JSON.stringify({ type: 'queue' }));
    await queued;
    const found = waitForMessage(quitter, 'match-found');
    const disconnected = waitForMessage<{ type: string; reason?: string }>(reconnect, 'match-ended');
    quitter.send(JSON.stringify({ type: 'queue' }));
    await found;
    quitter.close(1000, 'test-disconnect');
    const ending = await disconnected;
    assert.equal(ending.reason, 'opponent-disconnected');
  } finally {
    reconnect.close();
    quitter.close();
  }

  const updatedStats = await fetch(`${baseUrl}/api/pvp/stats`, { headers: { Authorization: `Bearer ${first.token}` } });
  assert.equal((await updatedStats.json() as { wins: number }).wins, 2);
  const quitStats = await fetch(`${baseUrl}/api/pvp/stats`, {
    headers: { Authorization: `Bearer ${disconnectedPilot.token}` },
  });
  assert.equal((await quitStats.json() as { losses: number }).losses, 1);
});
