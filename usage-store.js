import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { getUsage, estimateCost } from './usage.js';

const defaultPath = path.join(os.homedir(), '.mini-agent', 'usage.sqlite');

// Registro opcional para llamadas realizadas fuera de la instancia interactiva.
export function recordUsage({ model, usage, error = null }) {
  const store = new UsageStore();
  try { store.record({ model, usage, error }); } finally { store.db.close(); }
}

export class UsageStore {
  constructor(databasePath = process.env.MINI_AGENT_USAGE_DB || defaultPath) {
    this.path = databasePath;
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL,
      error TEXT
    ); CREATE INDEX IF NOT EXISTS idx_usage_created_at ON usage(created_at); CREATE INDEX IF NOT EXISTS idx_usage_model ON usage(model);`);
    this.insert = this.db.prepare(`INSERT INTO usage (model, input_tokens, output_tokens, total_tokens, cost_usd, error) VALUES (:model, :input_tokens, :output_tokens, :total_tokens, :cost_usd, :error)`);
  }

  record({ model, usage, error = null }) {
    const normalized = getUsage({ usage }) || { input: 0, output: 0, total: 0 };
    this.insert.run({ model, input_tokens: normalized.input, output_tokens: normalized.output, total_tokens: normalized.total, cost_usd: estimateCost(normalized, model), error: error ? String(error.message || error) : null });
  }

  summary(scope = 'all') {
    const conditions = [];
    if (scope === 'today') conditions.push("created_at >= datetime('now', 'start of day')");
    if (scope === 'month') conditions.push("created_at >= datetime('now', 'start of month')");
    if (scope !== 'all' && scope !== 'today' && scope !== 'month') conditions.push('model = :model');
    const query = `SELECT COUNT(*) requests, COALESCE(SUM(input_tokens), 0) input_tokens, COALESCE(SUM(output_tokens), 0) output_tokens, COALESCE(SUM(total_tokens), 0) total_tokens, COALESCE(SUM(cost_usd), 0) cost_usd, COALESCE(SUM(error IS NOT NULL), 0) errors FROM usage${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''}`;
    const statement = this.db.prepare(query);
    return scope !== 'all' && scope !== 'today' && scope !== 'month' ? statement.get({ model: scope }) : statement.get();
  }

  summarySince(timestamp) {
    const row = this.db.prepare(`SELECT COUNT(*) requests, COALESCE(SUM(input_tokens), 0) input_tokens, COALESCE(SUM(output_tokens), 0) output_tokens, COALESCE(SUM(total_tokens), 0) total_tokens, COALESCE(SUM(cost_usd), 0) cost_usd, COALESCE(SUM(error IS NOT NULL), 0) errors FROM usage WHERE created_at >= :timestamp`).get({ timestamp });
    return row;
  }

  sessionSummary() {
    return this.summarySince(this.sessionStartedAt);
  }

  startSession() {
    this.sessionStartedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  }

  formatSummary(summary) {
    return `${summary.requests} peticiones · ${summary.input_tokens} entrada · ${summary.output_tokens} salida · ${summary.total_tokens} tokens · ${Number(summary.cost_usd || 0).toFixed(6)} · ${summary.errors} errores`;
  }
}
