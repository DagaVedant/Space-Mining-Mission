import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticate, restoreCloudSave, syncCloudSave } from '../src/cloud';
import { newSave } from '../src/progress';

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('cloud saves', () => {
  let localStore: Map<string, string>;

  beforeEach(() => {
    localStore = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => localStore.get(key) ?? null,
      setItem: (key: string, value: string) => void localStore.set(key, value),
      removeItem: (key: string) => void localStore.delete(key),
    } as unknown as Storage);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('creates a cloud copy from the local campaign and remembers its account', async () => {
    const calls: { path: string; method: string; body: string }[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      const method = init.method ?? 'GET';
      calls.push({ path, method, body: String(init.body ?? '') });
      if (path === '/api/auth/register') return jsonResponse(200, { token: 'test-token', user: { id: 'pilot-1', username: 'pilot_one' } });
      if (path === '/api/save' && method === 'GET') return jsonResponse(404, { error: 'No cloud save exists for this account.' });
      if (path === '/api/save' && method === 'PUT') return jsonResponse(200, { revision: 1, updatedAt: Date.now() });
      return jsonResponse(404, { error: 'Unexpected request.' });
    });

    await authenticate('pilot_one', 'space-rocks-safe-2026', true);
    const local = newSave();
    local.money = 420;
    await expect(restoreCloudSave(local)).resolves.toBe(local);

    const upload = calls.find((call) => call.path === '/api/save' && call.method === 'PUT');
    expect(upload).toBeDefined();
    expect(JSON.parse(upload?.body ?? '').save.money).toBe(420);
    expect(localStore.get('rockbreaker-cloud-owner-v1')).toBe('pilot-1');
    expect(localStore.get('rockbreaker-save-v2')).toContain('"money":420');
  });

  it('does not upload another account’s local save over an existing cloud save', async () => {
    localStore.set('rockbreaker-account-v1', JSON.stringify({
      token: 'test-token',
      user: { id: 'account-two', username: 'pilot_two' },
      revision: 4,
    }));
    localStore.set('rockbreaker-cloud-owner-v1', 'account-one');
    const remote = newSave();
    remote.money = 250;
    remote.updatedAt = 200;
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      calls.push(`${init.method ?? 'GET'} ${path}`);
      return jsonResponse(200, { save: remote, revision: 5, updatedAt: 300 });
    });
    const local = newSave();
    local.money = 9000;
    local.updatedAt = 900;

    const result = await restoreCloudSave(local);
    expect(result.money).toBe(250);
    expect(result.updatedAt).toBe(300);
    expect(calls).toEqual(['GET /api/save']);
    expect(localStore.get('rockbreaker-cloud-owner-v1')).toBe('account-two');
  });

  // the server's revision rule, with enough delay for two requests to overlap
  function fakeServer(initial?: { money: number; revision: number; updatedAt: number }) {
    const row = initial
      ? { save: { ...newSave(), money: initial.money }, revision: initial.revision, updatedAt: initial.updatedAt }
      : { save: null as ReturnType<typeof newSave> | null, revision: 0, updatedAt: 0 };
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (init.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        if (body.revision !== row.revision) return jsonResponse(409, { error: 'Cloud save changed on another device.' });
        row.save = body.save;
        row.revision++;
        row.updatedAt = Date.now() + 1;
        return jsonResponse(200, { revision: row.revision, updatedAt: row.updatedAt });
      }
      if (!row.save) return jsonResponse(404, { error: 'No cloud save exists for this account.' });
      return jsonResponse(200, row);
    });
    return row;
  }

  const signedIn = () => localStore.set('rockbreaker-account-v1', JSON.stringify({
    token: 'test-token',
    user: { id: 'pilot-1', username: 'pilot_one' },
    revision: 0,
  }));

  it('keeps the cloud save when a device that never synced signs in with newer guest progress', async () => {
    const row = fakeServer({ money: 999, revision: 7, updatedAt: 200 });
    signedIn();
    const guest = { ...newSave(), money: 5, updatedAt: 900 };

    await expect(restoreCloudSave(guest)).resolves.toMatchObject({ money: 999 });
    expect(row.save?.money).toBe(999);
    expect(row.revision).toBe(7);
  });

  it('does not push guest progress over the cloud save when the sign-in restore never ran', async () => {
    const row = fakeServer({ money: 999, revision: 7, updatedAt: 200 });
    signedIn();
    const guest = { ...newSave(), money: 5, updatedAt: Date.now() };

    await syncCloudSave(guest);
    expect(row.save?.money).toBe(999);
    expect(guest.money).toBe(999);
  });

  it('keeps the newest of two saves made in quick succession', async () => {
    const row = fakeServer();
    signedIn();
    localStore.set('rockbreaker-cloud-owner-v1', 'pilot-1');
    const save = { ...newSave(), money: 200, updatedAt: Date.now() };

    const first = syncCloudSave(save);
    save.money = 300;
    save.updatedAt = Date.now();
    await Promise.all([first, syncCloudSave(save)]);

    expect(save.money).toBe(300);
    expect(row.save?.money).toBe(300);
  });
});
