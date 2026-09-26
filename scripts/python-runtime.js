import { spawnSync } from 'node:child_process';

const isWindows = process.platform === 'win32';

export function pythonCandidates() {
  if (process.env.LAYA_PYTHON) return [{ command: process.env.LAYA_PYTHON, args: [] }];
  return isWindows
    ? [{ command: 'python', args: [] }, { command: 'py', args: ['-3'] }, { command: 'python3', args: [] }]
    : [{ command: 'python3', args: [] }, { command: 'python', args: [] }];
}

export function inspectPython(candidate, checkLaya = false) {
  const source = checkLaya
    ? 'import laya; print("Laya " + str(getattr(laya, "__version__", "installed")))'
    : 'import sys; print(sys.executable)';
  const result = spawnSync(candidate.command, [...candidate.args, '-c', source], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

export function findPython(checkLaya = false) {
  for (const candidate of pythonCandidates()) {
    const output = inspectPython(candidate, checkLaya);
    if (output !== null) return { ...candidate, output };
  }
  return null;
}
