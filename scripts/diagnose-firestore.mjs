// Standalone Firestore reachability check. Run:  node scripts/diagnose-firestore.mjs
// Reads .env, points at the same project the app uses, and attempts one
// unauthenticated read. The resulting error code tells us which layer is broken.
import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";

// Optional arg: path to a different .env, so two projects can be compared.
const envPath = process.argv[2]
  ? new URL(process.argv[2], `file://${process.cwd()}/`)
  : new URL("../.env", import.meta.url);

const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => {
      const i = l.indexOf("=");
      // Vite strips surrounding quotes when it loads .env — match that, or we
      // end up querying a project whose name literally contains quote marks.
      const v = l.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
      return [l.slice(0, i).trim(), v];
    })
);

const projectId = env.VITE_FIREBASE_PROJECT_ID;
console.log("env file:", envPath.pathname);
console.log("project:", projectId);
console.log("database: (default)   <- what getFirestore(app) always targets\n");

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
});

try {
  // Plain id on purpose: Firestore reserves anything matching __...__ and
  // rejects it as invalid before rules are ever evaluated.
  await getDoc(doc(getFirestore(app), "users", "diagnostic-probe"));
  console.log("RESULT: read SUCCEEDED while signed out.");
  console.log("  -> The database exists, but your rules are wide open (not the");
  console.log("     rules in firestore.rules). Deploy them.");
} catch (err) {
  const code = err?.code ?? "(no code)";
  console.log("RESULT: read failed with code:", code);
  console.log("message:", err?.message, "\n");
  if (code === "permission-denied") {
    console.log("  -> GOOD news: the database EXISTS and rules ARE enforced.");
    console.log("     Denying a signed-out read is correct behavior here.");
    console.log("     So the app's failure is happening while authenticated —");
    console.log("     most likely the deployed rules differ from firestore.rules.");
    console.log("     Fix: firebase deploy --only firestore:rules");
  } else if (code === "unavailable") {
    // The SDK reports "offline" for anything that stopped it reaching the
    // backend. The real cause is the gRPC line logged ABOVE this verdict.
    console.log("  -> 'unavailable' just means the client gave up and went offline.");
    console.log("     Read the gRPC error logged above for the true cause:");
    console.log("       PERMISSION_DENIED on resource project  -> Cloud Firestore API");
    console.log("         is not enabled for this project, or the API key is");
    console.log("         restricted so it can't call Firestore.");
    console.log("       NOT_FOUND                              -> the (default) database");
    console.log("         does not exist (or you made a NAMED database instead).");
    console.log("       no gRPC line at all                    -> genuine network/DNS issue.");
  } else if (code === "not-found" || /NOT_FOUND/i.test(err?.message ?? "")) {
    console.log("  -> The (default) Firestore database does NOT exist in this project,");
    console.log("     or you created a NAMED database instead of (default).");
    console.log("     Fix: create the (default) database in the Firebase console,");
    console.log("     or pass the database id: getFirestore(app, '<your-db-name>')");
  } else {
    console.log("  -> Unexpected. Paste this output and I'll take it from here.");
  }
}
process.exit(0);
