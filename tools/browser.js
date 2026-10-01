import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { safePath } from './security.js';

const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
const NAVIGATION_TIMEOUT = 30_000;
let browser;
let page;
let browserSettings;

function chromeUserDataDir() {
  if (process.env.CHROME_USER_DATA_DIR) return process.env.CHROME_USER_DATA_DIR;
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Google', 'Chrome', 'User Data');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'google-chrome');
}

function chromeExecutable() {
  const candidates = process.platform === 'win32'
    ? [path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe')]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

function httpUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Solo se permiten URLs HTTP y HTTPS.');
  return url.href;
}

async function getPage({ show_browser = null, use_user_profile = null } = {}) {
  const requestedSettings = {
    show_browser: show_browser === null ? Boolean(browserSettings?.show_browser) : Boolean(show_browser),
    use_user_profile: use_user_profile === null ? Boolean(browserSettings?.use_user_profile) : Boolean(use_user_profile),
  };
  if (browser && (browserSettings.show_browser !== requestedSettings.show_browser || browserSettings.use_user_profile !== requestedSettings.use_user_profile)) {
    await browser.close();
    browser = undefined;
    page = undefined;
    browserSettings = undefined;
  }
  if (!browser) {
    const launchOptions = { headless: !requestedSettings.show_browser };
    if (requestedSettings.use_user_profile) {
      const userDataDir = chromeUserDataDir();
      if (!existsSync(userDataDir)) throw new Error(`No se encontró el perfil de Chrome en ${userDataDir}. Define CHROME_USER_DATA_DIR si está en otra ubicación.`);
      launchOptions.userDataDir = userDataDir;
      const executablePath = chromeExecutable();
      if (executablePath) launchOptions.executablePath = executablePath;
    }
    browser = await puppeteer.launch(launchOptions);
    browserSettings = requestedSettings;
  }
  if (!page || page.isClosed()) page = await browser.newPage();
  page.setDefaultTimeout(NAVIGATION_TIMEOUT);
  return page;
}

function result(value) { return JSON.stringify(value); }

export function validatePoint(current, x, y) {
  const width = current.viewport().width;
  const height = current.viewport().height;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= width || y >= height) {
    throw new Error(`Coordenadas fuera de la ventana: x debe estar entre 0 y ${width - 1}, e y entre 0 y ${height - 1}.`);
  }
}

export const browserTools = {
  browser_navigate: async ({ url, show_browser = null, use_user_profile = null }) => {
    try {
      const current = await getPage({ show_browser, use_user_profile });
      await current.goto(httpUrl(url), { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT });
      return result({ success: true, url: current.url(), title: await current.title(), show_browser: Boolean(browserSettings.show_browser), use_user_profile: Boolean(browserSettings.use_user_profile) });
    } catch (error) { return result({ success: false, error: error.message }); }
  },
  browser_click: async ({ selector }) => {
    try {
      const current = await getPage();
      await current.click(selector, { timeout: NAVIGATION_TIMEOUT });
      return result({ success: true, url: current.url(), title: await current.title() });
    } catch (error) { return result({ success: false, error: error.message }); }
  },
  browser_type: async ({ selector, text, press_enter = false }) => {
    try {
      const current = await getPage();
      await current.click(selector, { clickCount: 3, timeout: NAVIGATION_TIMEOUT });
      await current.type(selector, text);
      if (press_enter) await current.keyboard.press('Enter');
      return result({ success: true, url: current.url() });
    } catch (error) { return result({ success: false, error: error.message }); }
  },
  browser_screenshot: async ({ full_page = false, save_path = null }) => {
    try {
      const current = await getPage();
      const image = await current.screenshot({ type: 'png', fullPage: full_page, encoding: 'base64' });
      if (Buffer.byteLength(image, 'base64') > MAX_SCREENSHOT_BYTES) throw new Error('La captura supera el límite permitido.');

      let savedPath;
      if (save_path) {
        if (typeof save_path !== 'string' || path.isAbsolute(save_path)) throw new Error('save_path debe ser una ruta relativa al proyecto.');
        const absolutePath = safePath(save_path);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, Buffer.from(image, 'base64'));
        savedPath = path.relative(process.cwd(), absolutePath).replaceAll(path.sep, '/');
      }

      return result({ success: true, url: current.url(), title: await current.title(), mime_type: 'image/png', image_data: image, ...(savedPath ? { saved_path: savedPath } : {}) });
    } catch (error) { return result({ success: false, error: error.message }); }
  },
  // Computer-use controls operate inside the current Chromium page, not the host desktop.
  computer_click: async ({ x, y, button = 'left', click_count = 1 }) => {
    try {
      const current = await getPage();
      validatePoint(current, x, y);
      if (!['left', 'middle', 'right'].includes(button)) throw new Error('button debe ser left, middle o right.');
      if (!Number.isInteger(click_count) || click_count < 1 || click_count > 3) throw new Error('click_count debe ser un entero entre 1 y 3.');
      await current.mouse.click(x, y, { button, clickCount: click_count });
      return result({ success: true, x, y, button, click_count, url: current.url() });
    } catch (error) { return result({ success: false, error: error.message }); }
  },
  computer_type: async ({ text }) => {
    try {
      if (typeof text !== 'string' || text.length > 10_000) throw new Error('text debe ser una cadena de hasta 10 000 caracteres.');
      const current = await getPage();
      await current.keyboard.type(text);
      return result({ success: true, characters_typed: text.length, url: current.url() });
    } catch (error) { return result({ success: false, error: error.message }); }
  },
  computer_keypress: async ({ key }) => {
    try {
      if (typeof key !== 'string' || !key.trim() || key.length > 80) throw new Error('key debe ser una tecla o combinación de teclas válida.');
      const names = key.split('+').map((part) => part.trim());
      if (names.some((name) => !name) || names.length > 4) throw new Error('La combinación de teclas no es válida.');
      const aliases = { Ctrl: 'Control', Cmd: 'Meta', Command: 'Meta', Esc: 'Escape', Return: 'Enter', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
      const normalized = names.map((name) => aliases[name] || name);
      const modifiers = new Set(['Alt', 'Control', 'Meta', 'Shift']);
      const current = await getPage();
      const heldModifiers = normalized.slice(0, -1);
      if (heldModifiers.some((name) => !modifiers.has(name))) throw new Error('Solo se admiten Alt, Control, Meta y Shift como modificadores.');
      try {
        for (const modifier of heldModifiers) await current.keyboard.down(modifier);
        await current.keyboard.press(normalized.at(-1));
      } finally {
        for (const modifier of heldModifiers.reverse()) await current.keyboard.up(modifier);
      }
      return result({ success: true, key, url: current.url() });
    } catch (error) { return result({ success: false, error: error.message }); }
  },
  computer_scroll: async ({ x, y, delta_y }) => {
    try {
      const current = await getPage();
      validatePoint(current, x, y);
      if (!Number.isFinite(delta_y) || Math.abs(delta_y) > 5000) throw new Error('delta_y debe ser un número entre -5000 y 5000.');
      await current.mouse.move(x, y);
      await current.mouse.wheel({ deltaY: delta_y });
      return result({ success: true, x, y, delta_y, url: current.url() });
    } catch (error) { return result({ success: false, error: error.message }); }
  },
  computer_move: async ({ x, y }) => {
    try {
      const current = await getPage();
      validatePoint(current, x, y);
      await current.mouse.move(x, y);
      return result({ success: true, x, y, url: current.url() });
    } catch (error) { return result({ success: false, error: error.message }); }
  },
  computer_screenshot: async ({ save_path = null } = {}) => browserTools.browser_screenshot({ full_page: false, save_path }),
  browser_close: async () => {
    try { if (browser) await browser.close(); browser = undefined; page = undefined; browserSettings = undefined; return result({ success: true }); }
    catch (error) { return result({ success: false, error: error.message }); }
  },
};
