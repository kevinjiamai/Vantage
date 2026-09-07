import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadUserState, saveUserState, flushUserState, onSyncResult, subscribeAuth,
  signIn, signUp, signOut, deleteAccount, DEFAULT_PREFS,
  type User, type UserState,
} from "../lib/account";
import {
  DEFAULT_PROFILE, asPrefs, asWatchlists, DEFAULT_WATCHLISTS,
  type AppPage, type CloudStatus, type Profile, type Watchlist,
} from "../types";
import { usePersistentState } from "./usePersistentState";
import type { Portfolio } from "./usePortfolio";
import type { Preferences } from "./usePreferences";
import type { Quotes } from "./useQuotes";

const isProfile = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);

export interface CloudSync {
  user: User | null;
  profile: Profile;
  setProfile: (p: Profile) => void;
  cloudStatus: CloudStatus;
  /** Signed in AND data is going somewhere durable (or is still loading). */
  signedIn: boolean;
  /** Signed in but the cloud is unreachable — writes are suspended. */
  syncFailed: boolean;
  needsNameSetup: boolean;
  handleAuth: (mode: "signin" | "signup", email: string, password: string, name: string) => Promise<void>;
  handleSignOut: () => Promise<void>;
  handleDeleteAccount: (password: string) => Promise<void>;
  retry: () => void;
  completeOnboarding: (name: string, symbols: string[], lists: Watchlist[]) => void;
}

/**
 * Firebase Auth + Firestore document sync.
 *
 * The important invariant: a *failed* read is never treated as "new user".
 * Doing so wiped local trade data and re-ran onboarding on every hiccup, so on
 * error we keep local state and leave writes disabled rather than risk
 * overwriting a good cloud document with a blank slate.
 */
export function useCloudSync(
  portfolio: Portfolio,
  prefs: Preferences,
  quotes: Quotes,
  navigate: (page: AppPage) => void,
): CloudSync {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = usePersistentState<Profile>("vantage-profile", DEFAULT_PROFILE, isProfile);
  const [needsNameSetup, setNeedsNameSetup] = useState(false);
  const [setupComplete, setSetupComplete] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>("idle");

  /** Writes are only safe once we know what's in the cloud. */
  const cloudReady = useRef(false);
  /** Firebase emits null once at startup; only a later null is a real sign-out. */
  const authSettled = useRef(false);
  /** Name captured during sign-up, so onboarding never has to ask for it again. */
  const pendingSignupName = useRef("");

  const syncing = !!user && (cloudStatus === "idle" || cloudStatus === "loading");
  const syncFailed = !!user && cloudStatus === "error";
  const signedIn = !!user && (setupComplete || syncFailed || syncing);

  // Latest-value refs so the save effect doesn't need every field in its deps.
  const stateRef = useRef({ portfolio, prefs, profile });
  stateRef.current = { portfolio, prefs, profile };

  const buildCloudState = useCallback((): UserState => {
    const { portfolio: pf, prefs: pr, profile: prof } = stateRef.current;
    return {
      balance: pf.balance,
      holdings: pf.holdings,
      transactions: pf.transactions,
      profile: prof,
      setupComplete: true,
      watchlists: pr.watchlists,
      prefs: {
        homeRange: pr.homeRange,
        filter: pr.filter,
        sort: pr.sort,
        sortDir: pr.sortDir,
        changeDisplay: pr.changeDisplay,
        viewMode: pr.viewMode,
        theme: pr.theme,
        activeWatchlist: pr.activeWatchlist,
        pinnedSymbols: pr.pinnedSymbols,
        customOrders: pr.customOrders,
        detailRanges: pr.detailRanges,
      },
    };
  }, []);

  const resetToGuest = useCallback(() => {
    portfolio.reset();
    prefs.reset();
    setProfile(DEFAULT_PROFILE);
    setNeedsNameSetup(false);
    setSetupComplete(false);
    cloudReady.current = false;
    pendingSignupName.current = "";
  }, [portfolio, prefs, setProfile]);

  const loadCloudState = useCallback(async (next: User) => {
    cloudReady.current = false;
    setCloudStatus("loading");
    const email = next.email ?? "";
    // Identity comes from the Auth user, not Firestore. Seed it up front so a
    // failed cloud read can't leave the account page blank.
    const authName = next.name || pendingSignupName.current;
    setProfile(prev => ({
      ...prev,
      email: prev.email || email,
      name: prev.name || authName,
    }));
    try {
      const saved = await loadUserState();
      if (saved?.setupComplete && saved.profile?.name) {
        portfolio.replace(saved);
        setProfile({
          ...DEFAULT_PROFILE,
          ...saved.profile,
          email: saved.profile.email || email,
        });
        const lists = asWatchlists(saved.watchlists) ?? DEFAULT_WATCHLISTS;
        prefs.setWatchlists(lists);
        prefs.apply(asPrefs(saved.prefs), lists);
        void quotes.ensure([...new Set(lists.flatMap(w => w.symbols))]);
        setNeedsNameSetup(false);
        setSetupComplete(true);
      } else {
        // The read SUCCEEDED and there is genuinely no completed profile —
        // this is the only case where onboarding is the right answer.
        portfolio.reset();
        setProfile({ ...DEFAULT_PROFILE, email, name: authName });
        setNeedsNameSetup(true);
        setSetupComplete(false);
        navigate("account");
      }
      cloudReady.current = true;
      setCloudStatus("ready");
    } catch (err) {
      // The read FAILED, so we have no idea what's in the cloud. Treating that as
      // "new user" is what re-asked for the name and made the app look signed out.
      console.warn("Firestore load failed:", err);
      cloudReady.current = false;
      setCloudStatus("error");
    }
  }, [portfolio, prefs, quotes, navigate, setProfile]);

  // Keep the latest loader/reset in refs so the auth subscription mounts once and
  // is never torn down by an unrelated identity change.
  const loadRef = useRef(loadCloudState);
  loadRef.current = loadCloudState;
  const resetRef = useRef(resetToGuest);
  resetRef.current = resetToGuest;

  useEffect(() => {
    return subscribeAuth(next => {
      setUser(next);
      if (!next) {
        if (authSettled.current) resetRef.current();
        authSettled.current = true;
        setCloudStatus("idle");
        return;
      }
      authSettled.current = true;
      void loadRef.current(next);
    });
  }, []);

  const retry = useCallback(() => {
    if (user) void loadRef.current(user);
  }, [user]);

  // App drives the auth call so the sign-up name is recorded BEFORE Firebase fires
  // onAuthStateChanged. Setting it after signUp() resolves is already too late —
  // the listener has run and built the profile with an empty name.
  const handleAuth = useCallback(async (
    mode: "signin" | "signup", email: string, password: string, name: string,
  ) => {
    if (mode === "signup") {
      pendingSignupName.current = name;
      try {
        await signUp(email, password, name);
      } catch (err) {
        pendingSignupName.current = "";
        throw err;
      }
    } else {
      await signIn(email, password);
    }
  }, []);

  // Surface write failures the same way as read failures instead of only logging.
  useEffect(() => {
    onSyncResult(err => setCloudStatus(prev => (err ? "error" : prev === "error" ? "ready" : prev)));
    return () => onSyncResult(null);
  }, []);

  // cloudStatus is in the deps so a recovered sync flushes pending local changes
  // instead of waiting for the next unrelated edit.
  const { balance, holdings, transactions } = portfolio;
  const {
    watchlists, homeRange, filter, sort, sortDir, changeDisplay, viewMode, theme,
    activeWatchlist, pinnedSymbols, customOrders, detailRanges,
  } = prefs;
  useEffect(() => {
    if (!cloudReady.current || !user || !setupComplete) return;
    saveUserState(buildCloudState());
  }, [
    user, setupComplete, cloudStatus, buildCloudState,
    balance, holdings, transactions, profile, watchlists,
    homeRange, filter, sort, sortDir, changeDisplay, viewMode, theme,
    activeWatchlist, pinnedSymbols, customOrders, detailRanges,
  ]);

  // The cloud write is debounced; make sure it lands if the page is hidden or closed.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushUserState();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushUserState);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushUserState);
    };
  }, []);

  const completeOnboarding = useCallback((name: string, symbols: string[], lists: Watchlist[]) => {
    if (!user) return;
    const nextProfile: Profile = {
      ...profile,
      name,
      email: user.email ?? profile.email,
      pic: profile.pic || "",
    };
    setProfile(nextProfile);
    prefs.reset();
    prefs.setWatchlists(lists);
    portfolio.reset();
    setNeedsNameSetup(false);
    setSetupComplete(true);
    cloudReady.current = true;
    pendingSignupName.current = "";
    saveUserState({
      balance: 0,
      holdings: [],
      transactions: [],
      profile: nextProfile,
      setupComplete: true,
      watchlists: lists,
      prefs: { ...DEFAULT_PREFS, activeWatchlist: "portfolio" },
    });
    void quotes.ensure(symbols);
    navigate("home");
  }, [user, profile, prefs, portfolio, quotes, navigate, setProfile]);

  return {
    user, profile, setProfile, cloudStatus,
    signedIn, syncFailed, needsNameSetup,
    handleAuth,
    handleSignOut: useCallback(() => signOut(), []),
    handleDeleteAccount: useCallback((password: string) => deleteAccount(password), []),
    retry, completeOnboarding,
  };
}
