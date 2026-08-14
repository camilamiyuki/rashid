import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const dbPath =
  process.env.DB_PATH || path.join(process.cwd(), 'data', 'rashid.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS rachas (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    total_cents   INTEGER NOT NULL,
    pix_key       TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'aberto', -- aberto | fechado | concluido
    organizer_key TEXT NOT NULL,
    share_cents   INTEGER,
    br_code       TEXT,
    qr_data_url   TEXT,
    runner_id     TEXT, -- quem a roleta sorteou para descer e buscar
    created_at    INTEGER NOT NULL,
    closed_at     INTEGER
  );

  CREATE TABLE IF NOT EXISTS participants (
    id         TEXT PRIMARY KEY,
    racha_id   TEXT NOT NULL REFERENCES rachas(id) ON DELETE CASCADE,
    client_key TEXT NOT NULL,
    name       TEXT NOT NULL,
    confirmed  INTEGER NOT NULL DEFAULT 0,
    paid       INTEGER NOT NULL DEFAULT 0,
    UNIQUE (racha_id, client_key)
  );

  CREATE INDEX IF NOT EXISTS idx_participants_racha ON participants(racha_id);

  -- O id AUTOINCREMENT é também o cursor de paginação do chat: monotônico por
  -- inserção, então "id < ?" pagina para trás sem depender do relógio.
  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    racha_id    TEXT NOT NULL REFERENCES rachas(id) ON DELETE CASCADE,
    author_id   TEXT NOT NULL,
    author_name TEXT NOT NULL, -- cópia do nome no envio: o autor pode sair depois
    body        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_racha ON messages(racha_id, id);
`);

// Migrações leves: CREATE TABLE IF NOT EXISTS não altera tabela já existente,
// então colunas novas entram aqui para os bancos que já estão em produção.
const rachaColumns = db
  .prepare('PRAGMA table_info(rachas)')
  .all()
  .map((c) => c.name);
if (!rachaColumns.includes('runner_id'))
  db.exec('ALTER TABLE rachas ADD COLUMN runner_id TEXT');
