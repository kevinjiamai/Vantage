#!/usr/bin/env node
/**
 * Save this account's Firestore document to a local JSON file.
 *
 * Run this before migrating off Firebase. The password is read from the
 * terminal with echo off and is never written to disk or printed.
 *
 *   node scripts/backup-firestore.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, getFirestore } from "firebase/firestore";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (match && !process.env[match[1]]) {
          process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
        }
      }
    } catch {
      /* both files are optional */
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
        if (code === 127 || code === 8) {
          value = value.slice(0, -1);
        } else if (code >= 32) {
          value += char;
        }
      }
    };
    stdin.on("data", onData);
  });
}

const REQUIRED = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
];

async function main() {
  loadEnv();
  const missing = REQUIRED.filter(key => !process.env[key]);
  if (missing.length) {
    console.error(`Missing from .env: ${missing.join(", ")}`);
    process.exit(1);
  }

  const app = initializeApp({
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
  });

  const email = await ask("Email: ");
  const password = await askHidden("Password: ");

  let cred;
  try {
    cred = await signInWithEmailAndPassword(getAuth(app), email, password);
  } catch (err) {
    console.error(`Sign-in failed: ${err?.code ?? err}`);
    process.exit(1);
  }

  const snap = await getDoc(doc(getFirestore(app), "users", cred.user.uid));
  if (!snap.exists()) {
    console.error(`No document at users/${cred.user.uid}. Nothing to back up.`);
    process.exit(1);
  }

  const payload = {
    exported_at: new Date().toISOString(),
    uid: cred.user.uid,
    email: cred.user.email,
    display_name: cred.user.displayName ?? "",
    document: snap.data(),
  };

  mkdirSync("backups", { recursive: true });
  const path = `backups/firestore-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(path, JSON.stringify(payload, null, 2));

  const d = payload.document ?? {};
  console.log(`\nSaved ${path}`);
  console.log(`  watchlists   ${(d.watchlists ?? []).length}`);
  console.log(`  holdings     ${(d.holdings ?? []).length}`);
  console.log(`  transactions ${(d.transactions ?? []).length}`);
  console.log(`  balance      ${d.balance ?? 0}`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
