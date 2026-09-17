import { spawn } from 'node:child_process';

// Mantiene despierto el equipo únicamente mientras existe una tarea del agente.
// El proceso hijo termina siempre en stop(), por lo que no modifica la
// configuración permanente de energía del sistema.
export function startKeepAwake() {
  let child;
  try {
    if (process.platform === 'darwin') {
      child = spawn('caffeinate', ['-dimsu'], { stdio: 'ignore' });
    } else if (process.platform === 'linux') {
      child = spawn('systemd-inhibit', ['--what=idle:sleep', '--who=mini-agent', '--why=Agente trabajando', 'sleep', 'infinity'], { stdio: 'ignore' });
    } else if (process.platform === 'win32') {
      const script = "$sig = '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint esFlags);'; Add-Type -MemberDefinition $sig -Name Power -Namespace MiniAgent; while ($true) { [MiniAgent.Power]::SetThreadExecutionState(0x80000003); Start-Sleep -Seconds 30 }";
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', windowsHide: true });
    }
  } catch {
    child = undefined;
  }

  // Si la utilidad no existe o no puede iniciarse, el agente sigue funcionando.
  child?.unref();
  return () => {
    if (child && !child.killed) child.kill();
  };
}
