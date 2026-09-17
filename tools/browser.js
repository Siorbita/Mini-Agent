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
  browser_close: async () => {
    try { if (browser) await browser.close(); browser = undefined; page = undefined; return result({ success: true }); }
    catch (error) { return result({ success: false, error: error.message }); }
  },
};
