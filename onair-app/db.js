const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Certains systèmes de fichiers montés (ex: dossiers partagés/synchronisés) ne supportent
// pas le verrouillage fichier requis par SQLite. On stocke donc la base dans un répertoire
// de données local (variable d'env DB_DIR pour la personnaliser), par défaut un dossier
// dédié dans le répertoire temporaire du système — fiable sur tout environnement.
const DB_DIR = process.env.DB_DIR || path.join(os.tmpdir(), 'onair-app-data');
fs.mkdirSync(DB_DIR, { recursive: true });
const DB_PATH = path.join(DB_DIR, 'onair.db');

const db = new DatabaseSync(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  followers INTEGER NOT NULL,
  connected_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  plan TEXT NOT NULL,
  period TEXT NOT NULL,
  account_count INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  total_price INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  stripe_session_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  platform TEXT NOT NULL,
  duration_s INTEGER NOT NULL,
  score INTEGER NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT DEFAULT (datetime('now'))
);
`);

module.exports = db;
