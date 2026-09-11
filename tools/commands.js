import { PROJECT_ROOT } from './security.js';
import { COMMAND_TIMEOUT, runCommand } from './command-runner.js';

export const commandTools = {
  run_command: async ({ command, args = [], timeout = COMMAND_TIMEOUT }) => {
    try {
      if (!command || !/^[a-zA-Z0-9._-]+$/.test(command) || !Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) throw new Error('Comando o argumentos inválidos. Usa un ejecutable sin shell.');
      if (/(^|\s)(rm|del|format|shutdown|reboot|mkfs)(\s|$)/i.test([command, ...args].join(' '))) throw new Error('Comando potencialmente destructivo bloqueado.');
      const { stdout, stderr } = await runCommand(command, args, { cwd: PROJECT_ROOT, timeout });
      return JSON.stringify({ success: true, command: [command, ...args].join(' '), stdout: stdout.trim(), stderr: stderr.trim() });
    } catch (error) { return JSON.stringify({ success: false, error: error.message, stdout: error.stdout?.trim(), stderr: error.stderr?.trim() }); }
  },
};
