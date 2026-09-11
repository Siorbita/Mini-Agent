import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

export const CONFIG_DIR = path.join(os.homedir(), '.mini-agent');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  model: 'gpt-5.6-luna',
  color: true,
  verbose: false,
  confirmWrites: true,
};

export async function loadConfig() {
  try {
    const saved = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf8'));
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveConfig(updates) {
  const config = { ...(await loadConfig()), ...updates };
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config;
}
