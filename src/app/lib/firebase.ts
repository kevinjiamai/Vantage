import { initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import {
  doc,
  deleteDoc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

function requireEnv(name: keyof ImportMetaEnv): string {
  const v = import.meta.env[name];
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`Missing ${name}. Set it in .env / .env.production or Vercel env.`);
  }
  return v.trim();
}

let firebaseConfig: {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
};

try {
  firebaseConfig = {
    apiKey: requireEnv("VITE_FIREBASE_API_KEY"),
    authDomain: requireEnv("VITE_FIREBASE_AUTH_DOMAIN"),
    projectId: requireEnv("VITE_FIREBASE_PROJECT_ID"),
    storageBucket: requireEnv("VITE_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: requireEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
    appId: requireEnv("VITE_FIREBASE_APP_ID"),
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID?.trim() || undefined,
  };
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  document.body.innerHTML =
    `<pre style="font:14px/1.4 system-ui;padding:24px;white-space:pre-wrap">Vantage failed to start.\n\n${msg}</pre>`;
  throw err;
}

const app = initializeApp(firebaseConfig);
export { app };
export const auth = getAuth(app);
export const db = getFirestore(app);

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

export function subscribeAuth(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}

export async function signIn(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function signUp(email: string, password: string, name?: string): Promise<User> {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  const trimmed = name?.trim();
  if (trimmed) {
    // Store the name on the Auth user. Unlike Firestore this needs no database,
    // so the account still has an identity if the cloud read fails.
    try {
      await updateProfile(cred.user, { displayName: trimmed });
    } catch (err) {
      console.warn("Failed to set displayName:", err);
    }
  }
  return cred.user;
}

export async function signOut(): Promise<void> {
  pendingState = null;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await firebaseSignOut(auth);
}

/** Deletes Firestore user doc then the Auth user. May require recent login. */
export async function deleteAccount(): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  pendingState = null;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    await deleteDoc(doc(db, "users", user.uid));
  } catch (err) {
    console.warn("Failed to delete user doc:", err);
  }
  await deleteUser(user);
}

export function authErrorMessage(err: unknown): string {
  const code = typeof err === "object" && err && "code" in err
    ? String((err as { code: string }).code)
    : "";
  // Always log the real error. Returning only a friendly string used to discard
  // the code entirely, which left "Something went wrong" with nothing to debug.
  console.error("Auth error:", code || "(no code)", err);
  switch (code) {
    case "auth/email-already-in-use":
      return "That email is already registered. Sign in instead.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Try again later.";
    case "auth/requires-recent-login":
      return "Sign out and sign back in, then try deleting again.";
    case "auth/operation-not-allowed":
      return "Email/password sign-in is not enabled for this Firebase project.";
    case "auth/network-request-failed":
      return "Couldn’t reach Firebase. Check your connection and try again.";
    case "auth/api-key-not-valid":
    case "auth/invalid-api-key":
      return "This app’s Firebase API key is invalid. Check your .env.";
    case "auth/admin-restricted-operation":
      return "Sign-ups are disabled for this Firebase project.";
    case "auth/password-does-not-meet-requirements":
      return "Password doesn’t meet this project’s password policy.";
    case "auth/missing-password":
      return "Enter a password.";
    default:
      // Show the code — a generic message with no code is undebuggable.
      return code
        ? `Sign-in failed (${code}). See the browser console for details.`
        : "Something went wrong. Please try again.";
  }
}

export async function loadUserState(uid: string): Promise<Partial<UserState> | null> {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? (snap.data() as Partial<UserState>) : null;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingState: UserState | null = null;
let pendingUid: string | null = null;

/** Notified after every attempted write: null on success, the error on failure. */
let syncListener: ((err: unknown | null) => void) | null = null;
export function onSyncResult(cb: ((err: unknown | null) => void) | null) {
  syncListener = cb;
}

async function flush() {
  const state = pendingState;
  const uid = pendingUid;
  pendingState = null;
  if (!state || !uid) return;
  try {
    await setDoc(
      doc(db, "users", uid),
      { ...state, updatedAt: serverTimestamp() },
      { merge: true }
    );
    syncListener?.(null);
  } catch (err) {
    // Swallowing this is how a failing sync looks identical to a working one.
    console.warn("Firestore sync failed:", err);
    syncListener?.(err);
  }
}

/** Debounced write of the full user state to users/{uid}. */
export function saveUserState(uid: string, state: UserState) {
  pendingUid = uid;
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
