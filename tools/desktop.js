import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { safePath } from './security.js';

const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
let desktopModulePromise;

async function desktopModule() {
  desktopModulePromise ||= import('@computer-use/nut-js').then((module) => {
    const mouseSpeed = Number(process.env.MINI_AGENT_NUT_MOUSE_SPEED ?? 3000);
    const mouseDelay = Number(process.env.MINI_AGENT_NUT_MOUSE_DELAY_MS ?? 0);
    const keyboardDelay = Number(process.env.MINI_AGENT_NUT_KEYBOARD_DELAY_MS ?? 10);
    module.mouse.config.mouseSpeed = Number.isFinite(mouseSpeed) && mouseSpeed >= 100 && mouseSpeed <= 20_000 ? mouseSpeed : 3000;
    module.mouse.config.autoDelayMs = Number.isFinite(mouseDelay) && mouseDelay >= 0 && mouseDelay <= 1000 ? mouseDelay : 0;
    module.keyboard.config.autoDelayMs = Number.isFinite(keyboardDelay) && keyboardDelay >= 0 && keyboardDelay <= 1000 ? keyboardDelay : 10;
    return module;
  }).catch((error) => {
    desktopModulePromise = undefined;
    throw new Error(`No se pudo cargar el backend de escritorio: ${error.message}`);
  });
  return desktopModulePromise;
}

function result(value) { return JSON.stringify(value); }

export function validateDesktopPoint(x, y, width, height) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= width || y >= height) {
    throw new Error(`Coordenadas fuera de la pantalla: x debe estar entre 0 y ${width - 1}, e y entre 0 y ${height - 1}.`);
  }
}

export function validateDesktopRegion(region, width, height) {
  if (!region || typeof region !== 'object' || Array.isArray(region)) throw new Error('region debe incluir x, y, width y height.');
  const { x, y, width: regionWidth, height: regionHeight } = region;
  if (![x, y, regionWidth, regionHeight].every(Number.isFinite)
    || !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(regionWidth) || !Number.isInteger(regionHeight)
    || x < 0 || y < 0 || regionWidth < 1 || regionHeight < 1
    || x + regionWidth > width || y + regionHeight > height) {
    throw new Error(`La región debe ser un rectángulo entero dentro de la pantalla (${width}x${height}).`);
  }
}

async function validateCurrentPoint(module, x, y) {
  const width = await module.screen.width();
  const height = await module.screen.height();
  validateDesktopPoint(x, y, width, height);
}

function parseKeys(input, Key) {
  if (typeof input !== 'string' || !input.trim() || input.length > 80) throw new Error('key debe ser una tecla o combinación reconocida.');
  const aliases = {
    Control: 'LeftControl', Ctrl: 'LeftControl', Cmd: 'LeftSuper', Command: 'LeftSuper', Meta: 'LeftSuper', Super: 'LeftSuper',
    Alt: 'LeftAlt', Shift: 'LeftShift', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Esc: 'Escape', Return: 'Enter',
  };
  const names = input.split('+').map((part) => aliases[part.trim()] || part.trim());
  const keys = names.map((name) => {
    if (!Object.hasOwn(Key, name) || typeof Key[name] !== 'number') throw new Error(`Tecla no admitida: ${name}.`);
    return Key[name];
  });
  return keys;
}

export const desktopTools = {
  desktop_screenshot: async ({ save_path = null, region = null } = {}) => {
    let temporaryDirectory;
    try {
      const module = await desktopModule();
      temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-screen-'));
      const fileName = `screen-${randomUUID()}`;
      const screenSize = { width: await module.screen.width(), height: await module.screen.height() };
      let screenshotPath;
      if (region) {
        validateDesktopRegion(region, screenSize.width, screenSize.height);
        screenshotPath = await module.screen.captureRegion(
          fileName,
          new module.Region(region.x, region.y, region.width, region.height),
          module.FileType.PNG,
          temporaryDirectory,
        );
      } else {
        screenshotPath = await module.screen.capture(fileName, module.FileType.PNG, temporaryDirectory);
      }
      const image = await fs.readFile(screenshotPath);
      if (image.byteLength > MAX_SCREENSHOT_BYTES) throw new Error('La captura de escritorio supera el límite permitido de 8 MB.');

      let savedPath;
      if (save_path) {
        if (typeof save_path !== 'string' || path.isAbsolute(save_path)) throw new Error('save_path debe ser una ruta relativa al proyecto.');
        const absolutePath = safePath(save_path);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, image);
        savedPath = path.relative(process.cwd(), absolutePath).replaceAll(path.sep, '/');
      }
      return result({
        success: true,
        mime_type: 'image/png',
        image_data: image.toString('base64'),
        screen: screenSize,
        capture_region: region || { x: 0, y: 0, width: screenSize.width, height: screenSize.height },
        ...(savedPath ? { saved_path: savedPath } : {}),
      });
    } catch (error) { return result({ success: false, error: error.message }); }
    finally { if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {}); }
  },
  desktop_click: async ({ x, y, button = 'left', click_count = 1 }) => {
    try {
      const module = await desktopModule();
      await validateCurrentPoint(module, x, y);
      if (!['left', 'middle', 'right'].includes(button)) throw new Error('button debe ser left, middle o right.');
      if (!Number.isInteger(click_count) || click_count < 1 || click_count > 2) throw new Error('click_count debe ser 1 o 2.');
      await module.mouse.setPosition(new module.Point(x, y));
      const mouseButton = { left: module.Button.LEFT, middle: module.Button.MIDDLE, right: module.Button.RIGHT }[button];
      if (click_count === 2 && button === 'left') await module.mouse.doubleClick(mouseButton);
      else for (let count = 0; count < click_count; count += 1) await module.mouse.click(mouseButton);
      return result({ success: true, x, y, button, click_count });
    } catch (error) { return result({ success: false, error: error.message }); }
  },
  desktop_type: async ({ text }) => {
    try {
      if (typeof text !== 'string' || text.length > 10_000) throw new Error('text debe ser una cadena de hasta 10 000 caracteres.');
      const module = await desktopModule();
      await module.keyboard.type(text);
      return result({ success: true, characters_typed: text.length });
    } catch (error) { return result({ success: false, error: error.message }); }
  },
  desktop_keypress: async ({ key }) => {
    try {
      const module = await desktopModule();
      const keys = parseKeys(key, module.Key);
      try { await module.keyboard.pressKey(...keys); }
      finally { await module.keyboard.releaseKey(...keys); }
      return result({ success: true, key });
    } catch (error) { return result({ success: false, error: error.message }); }
  },
  desktop_scroll: async ({ x, y, delta_y }) => {
    try {
      const module = await desktopModule();
      await validateCurrentPoint(module, x, y);
      if (!Number.isFinite(delta_y) || delta_y === 0 || Math.abs(delta_y) > 2000) throw new Error('delta_y debe ser un número distinto de cero entre -2000 y 2000.');
      await module.mouse.setPosition(new module.Point(x, y));
      const steps = Math.max(1, Math.ceil(Math.abs(delta_y) / 120));
      if (delta_y > 0) await module.mouse.scrollDown(steps);
      else await module.mouse.scrollUp(steps);
      return result({ success: true, x, y, delta_y, steps });
    } catch (error) { return result({ success: false, error: error.message }); }
  },
  desktop_sequence: async ({ actions }) => {
    if (!Array.isArray(actions) || actions.length < 1 || actions.length > 25) return result({ success: false, error: 'actions debe contener entre 1 y 25 acciones.' });
    const completed = [];
    for (const [index, action] of actions.entries()) {
      try {
        if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('La acción debe ser un objeto.');
        const args = action;
        let output;
        if (args.type === 'move') {
          const module = await desktopModule();
          await validateCurrentPoint(module, args.x, args.y);
          await module.mouse.setPosition(new module.Point(args.x, args.y));
          output = { success: true, type: 'move', x: args.x, y: args.y };
        } else if (args.type === 'click') {
          const response = JSON.parse(await desktopTools.desktop_click(args));
          if (!response.success) throw new Error(response.error);
          output = { success: true, type: 'click', x: args.x, y: args.y };
        } else if (args.type === 'keypress') {
          const response = JSON.parse(await desktopTools.desktop_keypress({ key: args.key }));
          if (!response.success) throw new Error(response.error);
          output = { success: true, type: 'keypress', key: args.key };
        } else if (args.type === 'type') {
          const response = JSON.parse(await desktopTools.desktop_type({ text: args.text }));
          if (!response.success) throw new Error(response.error);
          output = { success: true, type: 'type', characters_typed: args.text.length };
        } else if (args.type === 'scroll') {
          const response = JSON.parse(await desktopTools.desktop_scroll(args));
          if (!response.success) throw new Error(response.error);
          output = { success: true, type: 'scroll', x: args.x, y: args.y, delta_y: args.delta_y };
        } else {
          throw new Error('type debe ser move, click, keypress, type o scroll.');
        }
        completed.push(output);
      } catch (error) {
        return result({ success: false, completed, failed_index: index, error: error.message });
      }
    }
    return result({ success: true, completed });
  },
};
