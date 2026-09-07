import { apiUrl } from "./stocks";

/** Persisted All-Stocks toolbar + layout prefs */
export interface UserPrefs {
  homeRange: string;
  filter: string;
  sort: string;
  sortDir: string;
  changeDisplay: string;
  viewMode: string;
  theme: string;
  activeWatchlist: string;
  pinnedSymbols: string[];
  /** Manual card order per watchlist id */
  customOrders: Record<string, string[]>;
  /** Last selected chart range per symbol */
  detailRanges: Record<string, string>;
}

export interface UserState {
  balance: number;
  holdings: unknown[];
  transactions: unknown[];
  profile: { name: string; email: string; pic: string };
  setupComplete?: boolean;
  watchlists: unknown[];
  prefs: UserPrefs;
}

export const DEFAULT_PREFS: UserPrefs = {
  homeRange: "1D",
  filter: "all",
  sort: "manual",
  sortDir: "desc",
  changeDisplay: "percent",
  viewMode: "grid",
  theme: "dark",
  activeWatchlist: "portfolio",
  pinnedSymbols: [],
  customOrders: {},
  detailRanges: {},
};

/** The signed-in account, as this service describes it. */
export interface User {
  id: string;
  email: string;
  name: string;
  tier: string;
  created_at: string | null;
}

const TOKEN_KEY = "vantage-session";

/** Carries the server's message and status so callers can react to either. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// ─── Session ───────────────────────────────────────────────────────────────────
// The token lives in this browser only. Nothing else identifies the user to the
// service, so losing it is exactly equivalent to signing out.

let token: string | null = readToken();
let currentUser: User | null = null;
const listeners = new Set<(user: User | null) => void>();

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(value: string | null) {
  token = value;
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the session simply won't outlive the tab */
  }
}

function setUser(user: User | null) {
  currentUser = user;
  for (const cb of listeners) cb(user);
}

export function getToken(): string | null {
  return token;
}

export function getUser(): User | null {
  return currentUser;
}

export function authHeader(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...authHeader(),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection.", 0);
  }

  if (res.status === 204) return undefined as T;

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* some errors have no body */
  }

  if (!res.ok) {
    const detail = (body as { detail?: unknown } | null)?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : typeof (detail as { message?: string })?.message === "string"
          ? (detail as { message: string }).message
          : `Request failed (${res.status})`;
    // A rejected token is a dead session; drop it rather than retrying forever.
    if (res.status === 401 && token && !path.startsWith("/api/auth/login")) {
      writeToken(null);
      setUser(null);
    }
    throw new ApiError(message, res.status);
  }
  return body as T;
}

/**
 * Subscribe to sign-in state. Fires immediately with what is known, then
 * confirms against the server, mirroring the shape the app already expects.
 */
export function subscribeAuth(cb: (user: User | null) => void): () => void {
  listeners.add(cb);
  cb(currentUser);
  if (token && !currentUser) {
    void request<{ user: User }>("/api/auth/me")
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null));
  } else if (!token) {
    // Report "signed out" asynchronously so subscribers see a settled state
    // rather than treating the initial synchronous null as the answer.
    queueMicrotask(() => cb(null));
  }
  return () => listeners.delete(cb);
}

export async function signIn(email: string, password: string): Promise<User> {
  const { token: fresh, user } = await request<{ token: string; user: User }>(
    "/api/auth/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
  );
  writeToken(fresh);
  setUser(user);
  return user;
}

export async function signUp(email: string, password: string, name?: string): Promise<User> {
  const { token: fresh, user } = await request<{ token: string; user: User }>(
    "/api/auth/signup",
    { method: "POST", body: JSON.stringify({ email, password, name: name ?? "" }) },
  );
  writeToken(fresh);
  setUser(user);
  return user;
}

export async function signOut(): Promise<void> {
  pendingState = null;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  writeToken(null);
  setUser(null);
}

export async function updateName(name: string): Promise<User> {
  const { user } = await request<{ user: User }>("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  setUser(user);
  return user;
}

export async function changePassword(current: string, next: string): Promise<void> {
  const { token: fresh, user } = await request<{ token: string; user: User }>(
    "/api/auth/password",
    { method: "POST", body: JSON.stringify({ current_password: current, new_password: next }) },
  );
  // The change retired every token including ours, so adopt the new one.
  writeToken(fresh);
  setUser(user);
}

/** Requires the password again: a stolen session should not be able to delete the account. */
export async function deleteAccount(password: string): Promise<void> {
  await request("/api/auth/account", {
    method: "DELETE",
    body: JSON.stringify({ password }),
  });
  pendingState = null;
  writeToken(null);
  setUser(null);
}

export function authErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong. Please try again.";
}

// ─── Saved state ───────────────────────────────────────────────────────────────

export async function loadUserState(): Promise<Partial<UserState> | null> {
  const { state } = await request<{ state: Partial<UserState> | null }>("/api/state");
  return state;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingState: UserState | null = null;

/** Notified after every attempted write: null on success, the error on failure. */
let syncListener: ((err: unknown | null) => void) | null = null;
export function onSyncResult(cb: ((err: unknown | null) => void) | null) {
  syncListener = cb;
}

async function flush() {
  const state = pendingState;
  pendingState = null;
  if (!state || !token) return;
  try {
    await request("/api/state", { method: "PUT", body: JSON.stringify(state) });
    syncListener?.(null);
  } catch (err) {
    // Swallowing this is how a failing sync looks identical to a working one.
    console.warn("State sync failed:", err);
    syncListener?.(err);
  }
}

/** Debounced write of the full user state. */
export function saveUserState(state: UserState) {
  pendingState = state;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 800);
}

/** Write any debounced state immediately — call before the page can go away. */
export function flushUserState(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  return flush();
}
