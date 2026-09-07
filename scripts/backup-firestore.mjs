#!/usr/bin/env node
/**
 * Save this account's Firestore document to a local JSON file.
 *
 * Run before migrating off Firebase. Uses the Firebase REST APIs directly so it
 * needs no dependencies -- the firebase package is no longer installed.
 *
 * The password is read with terminal echo off and is never written or printed.
 *
 *   node scripts/backup-firestore.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

function loadEnv() {
  for (const file of [".env.local", ".env", ".env.production"]) {
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (match && !process.env[match[1]]) {
          process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
        }
      }
    } catch {
      /* every file is optional */
    }
  }
}

function ask(question) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Read a line with echo suppressed, so it never reaches the screen or scrollback. */
function askHidden(question) {
  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    const { stdin } = process;
    if (!stdin.isTTY) {
      reject(new Error("password entry needs an interactive terminal"));
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";
    const onData = chunk => {
      for (const char of chunk) {
        const code = char.charCodeAt(0);
        if (code === 13 || code === 10) {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (code === 3) {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (code === 127 || code === 8) value = value.slice(0, -1);
        else if (code >= 32) value += char;
      }
    };
    stdin.on("data", onData);
  });
}

/**
 * Firestore's REST API returns every value wrapped in its type, e.g.
 * {stringValue: "AAPL"} or {arrayValue: {values: [...]}}. Unwrap to plain JSON.
 */
function decode(value) {
  if (value == null) return null;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  // Integers arrive as strings to survive values beyond 2^53.
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("bytesValue" in value) return value.bytesValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("geoPointValue" in value) return value.geoPointValue;
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(decode);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields ?? {});
  return null;
}

function decodeFields(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) out[key] = decode(value);
  return out;
}

async function main() {
  loadEnv();
  const apiKey = process.env.VITE_FIREBASE_API_KEY;
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    console.error(
      "Missing VITE_FIREBASE_API_KEY / VITE_FIREBASE_PROJECT_ID.\n" +
      "Expected in .env, .env.local or .env.production."
    );
    process.exit(1);
  }
  console.log(`Project: ${projectId}\n`);

  const email = await ask("Email: ");
  const password = await askHidden("Password: ");

  const signIn = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const auth = await signIn.json();
  if (!signIn.ok) {
    console.error(`\nSign-in failed: ${auth?.error?.message ?? signIn.status}`);
    process.exit(1);
  }

  const { idToken, localId: uid, displayName = "" } = auth;
  const docUrl =
    `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/(default)/documents/users/${uid}`;
  const res = await fetch(docUrl, { headers: { Authorization: `Bearer ${idToken}` } });
  const doc = await res.json();
  if (!res.ok) {
    console.error(`\nCould not read users/${uid}: ${doc?.error?.message ?? res.status}`);
    process.exit(1);
  }

  const document = decodeFields(doc.fields ?? {});
  const payload = {
    exported_at: new Date().toISOString(),
    uid,
    email: auth.email ?? email,
    display_name: displayName,
    document,
  };

  mkdirSync("backups", { recursive: true });
  const path = `backups/firestore-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(path, JSON.stringify(payload, null, 2));

  console.log(`\nSaved ${path}`);
  console.log(`  uid          ${uid}`);
  console.log(`  watchlists   ${(document.watchlists ?? []).length}`);
  for (const w of document.watchlists ?? []) {
    console.log(`     ${w.name ?? w.id} — ${(w.symbols ?? []).length} symbols`);
  }
  console.log(`  holdings     ${(document.holdings ?? []).length}`);
  console.log(`  transactions ${(document.transactions ?? []).length}`);
  console.log(`  balance      ${document.balance ?? 0}`);
  console.log(`  profile      ${document.profile?.name ?? "(none)"}`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
