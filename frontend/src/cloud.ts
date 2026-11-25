import { newSave, normalizeSave, persist, type SaveData } from './progress';

export interface Account {
  id: string;
  username: string;
}

export interface AuthState {
  token: string;
  user: Account;
  revision: number;
}

interface SaveResponse {
  save: unknown;
  revision: number;
  updatedAt: number;
}

const AUTH_KEY = 'rockbreaker-account-v1';
const OWNER_KEY = 'rockbreaker-cloud-owner-v1';
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

function authState(): AuthState | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as AuthState;
    if (!value.token || !value.user?.id || !value.user?.username || !Number.isInteger(value.revision)) return null;
    return value;
  } catch (error) {
    console.warn('Unable to read the saved account session.', error);
    return null;
  }
}

function storeAuth(state: AuthState | null): void {
  try {
    if (state) localStorage.setItem(AUTH_KEY, JSON.stringify(state));
    else localStorage.removeItem(AUTH_KEY);
  } catch (error) {
    console.error('Unable to store the account session locally.', error);
    throw new Error('Account session could not be saved in this browser.', { cause: error });
  }
}

function cloudOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch (error) {
    console.warn('Unable to read the local cloud-save owner.', error);
    return null;
  }
}

function storeCloudOwner(userId: string): void {
  try {
    localStorage.setItem(OWNER_KEY, userId);
  } catch (error) {
    console.error('Unable to remember which account owns the local cloud save.', error);
    throw new Error('Cloud save account binding could not be stored.', { cause: error });
  }
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    throw new Error(`Backend unavailable: ${error instanceof Error ? error.message : 'network request failed'}`, { cause: error });
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Backend request failed (${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function currentAccount(): Account | null {
  return authState()?.user ?? null;
}

export async function authenticate(username: string, password: string, register: boolean): Promise<AuthState> {
  const result = await request<{ token: string; user: Account }>(
    register ? '/api/auth/register' : '/api/auth/login',
    { method: 'POST', body: JSON.stringify({ username, password }) },
  );
  const state = { ...result, revision: 0 };
  storeAuth(state);
  return state;
}

export async function signOut(): Promise<void> {
  const state = authState();
  if (state) {
    try {
      await request<void>('/api/auth/logout', { method: 'POST' }, state.token);
    } finally {
      storeAuth(null);
    }
  }
}

async function readCloudSave(state: AuthState): Promise<SaveResponse | null> {
  try {
    return await request<SaveResponse>('/api/save', {}, state.token);
  } catch (error) {
    if (error instanceof Error && error.message === 'No cloud save exists for this account.') return null;
    throw error;
  }
}

async function putSave(state: AuthState, save: SaveData): Promise<void> {
  if (save.updatedAt <= 0) save.updatedAt = Date.now();
  const result = await request<{ revision: number; updatedAt: number }>(
    '/api/save',
    { method: 'PUT', body: JSON.stringify({ save, revision: state.revision }) },
    state.token,
  );
  state.revision = result.revision;
  storeAuth(state);
  persist(save, false, false);
}

export async function restoreCloudSave(localSave: SaveData | null): Promise<SaveData> {
  const state = authState();
  if (!state) return localSave ?? newSave();
  const owner = cloudOwner();
  const ownerMatches = !owner || owner === state.user.id;
  const remote = await readCloudSave(state);
  if (!remote) {
    const initial = ownerMatches && localSave ? localSave : newSave();
    await putSave(state, initial);
    storeCloudOwner(state.user.id);
    return initial;
  }
  state.revision = remote.revision;
  storeAuth(state);
  const cloudSave = normalizeSave(remote.save);
  if (!cloudSave) throw new Error('The cloud save is invalid and could not be loaded.');
  if (ownerMatches && localSave && localSave.updatedAt > remote.updatedAt) {
    await putSave(state, localSave);
    storeCloudOwner(state.user.id);
    return localSave;
  }
  cloudSave.updatedAt = remote.updatedAt;
  persist(cloudSave, false, false);
  storeCloudOwner(state.user.id);
  return cloudSave;
}

export async function syncCloudSave(save: SaveData): Promise<void> {
  const state = authState();
  if (!state) return;
  try {
    await putSave(state, save);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('Cloud save changed on another device.')) throw error;
    const remote = await readCloudSave(state);
    if (!remote) throw error;
    state.revision = remote.revision;
    const remoteSave = normalizeSave(remote.save);
    if (!remoteSave) throw new Error('The updated cloud save is invalid.', { cause: error });
    if (remote.updatedAt > save.updatedAt) {
      Object.assign(save, remoteSave, { updatedAt: remote.updatedAt });
      persist(save, false, false);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('rockbreaker-cloud-save-updated'));
      storeAuth(state);
      return;
    }
    await putSave(state, save);
  }
}

export function websocketUrl(): string {
  const configured = import.meta.env.VITE_WS_URL as string | undefined;
  if (configured) return configured;
  const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (apiUrl) return apiUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
}

export function accountToken(): string | null {
  return authState()?.token ?? null;
}
