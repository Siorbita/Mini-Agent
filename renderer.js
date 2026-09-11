const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function paint(code, value, enabled) {
  return enabled ? `${code}${value}${ANSI.reset}` : value;
}

function renderInline(value, useColor) {
  const tokens = [];
  const stash = (content) => `\u0000${tokens.push(content) - 1}\u0000`;
  let text = String(value)
    .replace(/`([^`\n]+)`/g, (_, code) => stash(paint(ANSI.yellow, code, useColor)))
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => stash(`${alt} (${url})`))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => stash(`${label} (${url})`));

  text = text
    .replace(/\*\*([^*\n]+)\*\*/g, (_, content) => paint(ANSI.bold, content, useColor))
    .replace(/__([^_\n]+)__/g, (_, content) => paint(ANSI.bold, content, useColor))
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, (_, content) => paint(ANSI.italic, content, useColor))
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, (_, content) => paint(ANSI.italic, content, useColor))
    .replace(/~~([^~\n]+)~~/g, (_, content) => paint(ANSI.dim, content, useColor));

  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
}

function renderCode(code, language, useColor) {
  const label = language ? ` ${language}` : '';
  const top = paint(ANSI.gray, `┌─${label}`, useColor);
  const bottom = paint(ANSI.gray, '└─', useColor);
  const lines = String(code).replace(/\n$/, '').split('\n');
  return [top, ...lines.map((line) => `${paint(ANSI.gray, '│', useColor)} ${line}`), bottom].join('\n');
}

function renderTable(lines, useColor) {
  const rows = lines.filter((line) => !/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line));
  const cells = rows.map((line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()));
  if (!cells.length) return lines.join('\n');
  const width = Math.max(...cells.map((row) => row.length));
  const normalized = cells.map((row) => [...row, ...Array(width - row.length).fill('')]);
  const sizes = Array.from({ length: width }, (_, index) => Math.max(...normalized.map((row) => row[index].length)));
  const separator = `├${sizes.map((size) => '─'.repeat(size + 2)).join('┼')}┤`;
  const format = (row) => `│ ${row.map((cell, index) => cell.padEnd(sizes[index])).join(' │ ')} │`;
  return [format(normalized[0]), separator, ...normalized.slice(1).map(format)].map((line) => paint(ANSI.gray, line, useColor)).join('\n');
}

export function renderMarkdown(markdown, { color = true } = {}) {
  const useColor = Boolean(color);
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let codeLines = null;
  let codeLanguage = '';
  let tableLines = [];

  const flushTable = () => {
    if (tableLines.length) {
      output.push(renderTable(tableLines, useColor));
      tableLines = [];
    }
  };

  for (const line of lines) {
    const fence = line.match(/^\s*```\s*([^ ]*)\s*$/);
    if (fence) {
      flushTable();
      if (codeLines) {
        output.push(renderCode(codeLines.join('\n'), codeLanguage, useColor));
        codeLines = null;
        codeLanguage = '';
      } else {
        codeLines = [];
        codeLanguage = fence[1];
      }
      continue;
    }
    if (codeLines) {
      codeLines.push(line);
      continue;
    }
    if (/^\s*\|?.+\|.+\|?\s*$/.test(line) && line.includes('|')) {
      tableLines.push(line);
      continue;
    }
    flushTable();

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      output.push(paint(ANSI.bold + ANSI.cyan, heading[2], useColor));
      continue;
    }
    const list = line.match(/^(\s*)([-*+] |\d+[.)] )(.*)$/);
    if (list) {
      output.push(`${list[1]}${paint(ANSI.blue, list[2], useColor)}${renderInline(list[3], useColor)}`);
      continue;
    }
    if (/^\s*>/.test(line)) {
      output.push(paint(ANSI.gray, line.replace(/^\s*>??\s?/, '│ '), useColor));
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) {
      output.push(paint(ANSI.gray, '─'.repeat(40), useColor));
      continue;
    }
    output.push(renderInline(line, useColor));
  }

  if (codeLines) output.push(renderCode(codeLines.join('\n'), codeLanguage, useColor));
  flushTable();
  return output.join('\n');
}

export function stripAnsi(value) {
  return String(value).replace(new RegExp(`${escapeRegExp('\x1b')}\\[[0-9;]*m`, 'g'), '');
}
