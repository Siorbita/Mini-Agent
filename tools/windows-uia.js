import { spawn } from 'node:child_process';
import { desktopTools } from './desktop.js';
const MAX_OUTPUT = 2 * 1024 * 1024;
const MAX_ELEMENTS = 300;
const MAX_DEPTH = 8;

function powershellScript(request) {
  const requestBase64 = Buffer.from(JSON.stringify(request), 'utf8').toString('base64');
  return `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace MiniAgentWindowsAutomation {
  public static class NativeMethods {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  }
}
'@
  $request = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${requestBase64}')) | ConvertFrom-Json
  $hwnd = [MiniAgentWindowsAutomation.NativeMethods]::GetForegroundWindow()
  if ($hwnd -eq [IntPtr]::Zero) { throw 'No se encontró una ventana activa.' }
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
  if ($null -eq $root) { throw 'UI Automation no pudo acceder a la ventana activa.' }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $elements = New-Object System.Collections.Generic.List[object]
  function Read-Element($element, [string]$id, [int]$depth) {
    if ($elements.Count -ge ${MAX_ELEMENTS}) { return }
    try {
      $current = $element.Current
      $rect = $current.BoundingRectangle
      $bounds = $null
      if (-not $rect.IsEmpty -and $rect.Width -gt 0 -and $rect.Height -gt 0) {
        $bounds = @{ x = [Math]::Round($rect.Left); y = [Math]::Round($rect.Top); width = [Math]::Round($rect.Width); height = [Math]::Round($rect.Height) }
      }
      $entry = [ordered]@{
        element_id = $id
        name = [string]$current.Name
        automation_id = [string]$current.AutomationId
        control_type = [string]$current.ControlType.ProgrammaticName
        class_name = [string]$current.ClassName
        is_enabled = [bool]$current.IsEnabled
        is_offscreen = [bool]$current.IsOffscreen
        bounds = $bounds
      }
      $elements.Add($entry)
      if ($depth -ge ${MAX_DEPTH} -or $elements.Count -ge ${MAX_ELEMENTS}) { return }
      $child = $walker.GetFirstChild($element)
      $index = 0
      while ($null -ne $child -and $elements.Count -lt ${MAX_ELEMENTS}) {
        Read-Element $child ($id + '.' + $index) ($depth + 1)
        $child = $walker.GetNextSibling($child)
        $index++
      }
    } catch { }
  }
  Read-Element $root 'root' 0
  if ($request.operation -eq 'inspect') {
    $window = $root.Current
    @{ success = $true; window = @{ name = [string]$window.Name; automation_id = [string]$window.AutomationId; process_id = [int]$window.ProcessId; bounds = @{ x = [Math]::Round($window.BoundingRectangle.Left); y = [Math]::Round($window.BoundingRectangle.Top); width = [Math]::Round($window.BoundingRectangle.Width); height = [Math]::Round($window.BoundingRectangle.Height) } }; elements = @($elements); truncated = ($elements.Count -ge ${MAX_ELEMENTS}) } | ConvertTo-Json -Depth 8 -Compress
  } elseif ($request.operation -eq 'click') {
    $matches = @($elements | Where-Object {
      $entry = $_
      $nameMatches = [string]::Equals($entry.name, [string]$request.name, [System.StringComparison]::OrdinalIgnoreCase)
      $idMatches = ([string]::IsNullOrEmpty([string]$request.automation_id) -or [string]::Equals($entry.automation_id, [string]$request.automation_id, [System.StringComparison]::Ordinal))
      $typeMatches = ([string]::IsNullOrEmpty([string]$request.control_type) -or [string]::Equals($entry.control_type, [string]$request.control_type, [System.StringComparison]::OrdinalIgnoreCase))
      $nameMatches -and $idMatches -and $typeMatches -and $entry.is_enabled -and -not $entry.is_offscreen
    })
    if ($matches.Count -eq 0) { throw 'No se encontró un control visible y habilitado que coincida con el selector en la ventana activa.' }
    if ($null -eq $request.occurrence -and $matches.Count -gt 1) { @{ success = $false; ambiguous = $true; matches = @($matches | Select-Object -First 10) } | ConvertTo-Json -Depth 8 -Compress; exit 0 }
    $index = if ($null -eq $request.occurrence) { 0 } else { [int]$request.occurrence }
    if ($index -lt 0 -or $index -ge $matches.Count) { throw 'occurrence queda fuera del número de controles coincidentes.' }
    $selected = $matches[$index]
    $target = $root
    if ($selected.element_id -ne 'root') {
      foreach ($part in $selected.element_id.Substring(5).Split('.')) { $target = $walker.GetFirstChild($target); for ($step = 0; $step -lt [int]$part; $step++) { $target = $walker.GetNextSibling($target) } }
    }
    $invoked = $false
    try {
      $pattern = $null
      if ($target.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $pattern.Invoke(); $invoked = $true }
    } catch { }
    @{ success = $true; invoked = $invoked; element = $selected } | ConvertTo-Json -Depth 8 -Compress
  } else { throw 'Operación UI Automation no válida.' }
} catch {
  @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Depth 6 -Compress
}`;
}

async function invokeWindowsAutomation(request) {
  if (process.platform !== 'win32') throw new Error('UI Automation solo está disponible en Windows.');
  const encoded = Buffer.from(powershellScript(request), 'utf16le').toString('base64');
  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const timeout = setTimeout(() => child.kill(), 15_000);
  try {
    const { code, signal } = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
    });
    if (Buffer.byteLength(stdout, 'utf8') > MAX_OUTPUT) throw new Error('La respuesta UI Automation supera el límite permitido.');
    if (code !== 0) throw new Error(`PowerShell UI Automation terminó con ${signal || `código ${code}`}${stderr.trim() ? `: ${stderr.trim()}` : ''}`);
    const output = stdout.trim();
    if (!output) throw new Error(`PowerShell UI Automation no devolvió resultados.${stderr.trim() ? ` ${stderr.trim()}` : ''}`);
    return JSON.parse(output);
  } finally { clearTimeout(timeout); }
}

function result(value) { return JSON.stringify(value); }

export const windowsAutomationTools = {
  desktop_inspect: async () => {
    try { return result(await invokeWindowsAutomation({ operation: 'inspect' })); }
    catch (error) { return result({ success: false, error: error.message }); }
  },
  desktop_click_element: async ({ name, automation_id = null, control_type = null, occurrence = null }) => {
    try {
      if (typeof name !== 'string' || !name.trim() || name.length > 500) throw new Error('name debe ser un nombre accesible no vacío de hasta 500 caracteres.');
      if (automation_id !== null && (typeof automation_id !== 'string' || automation_id.length > 500)) throw new Error('automation_id debe ser una cadena de hasta 500 caracteres o null.');
      if (control_type !== null && (typeof control_type !== 'string' || control_type.length > 100)) throw new Error('control_type debe ser una cadena de hasta 100 caracteres o null.');
      if (occurrence !== null && (!Number.isInteger(occurrence) || occurrence < 0 || occurrence > 299)) throw new Error('occurrence debe ser un índice no negativo o null.');
      const response = await invokeWindowsAutomation({ operation: 'click', name: name.trim(), automation_id, control_type, occurrence });
      if (!response.success || response.ambiguous || response.invoked) return result(response);
      const bounds = response.element?.bounds;
      if (!bounds) return result({ success: false, error: 'El control no admite InvokePattern y no tiene coordenadas utilizables.', element: response.element });
      const x = Math.round(bounds.x + bounds.width / 2);
      const y = Math.round(bounds.y + bounds.height / 2);
      const click = JSON.parse(await desktopTools.desktop_click({ x, y, button: 'left', click_count: 1 }));
      if (!click.success) return result({ success: false, error: click.error, element: response.element });
      return result({ success: true, invoked: false, clicked_with_nut_js: true, x, y, element: response.element });
    } catch (error) { return result({ success: false, error: error.message }); }
  },
};

const stringProperty = (description) => ({ type: 'string', description });
const nullableStringProperty = (description) => ({ type: ['string', 'null'], description });

export const windowsAutomationToolsSchema = [
  {
    type: 'function', name: 'desktop_inspect',
    description: 'En Windows, inspecciona los controles accesibles de la ventana activa mediante UI Automation. Devuelve nombres, tipos, estados y rectángulos; el árbol puede estar incompleto en aplicaciones que no exponen accesibilidad.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }, strict: true,
  },
  {
    type: 'function', name: 'desktop_click_element',
    description: 'En Windows, localiza un control accesible por nombre y filtros opcionales. Requiere coincidencia única salvo que se indique occurrence. Invoca UI Automation cuando es posible y usa nut.js con el centro del rectángulo como alternativa.',
    parameters: {
      type: 'object',
      properties: {
        name: stringProperty('Nombre accesible exacto, obtenido preferiblemente de desktop_inspect.'),
        automation_id: nullableStringProperty('AutomationId exacto como filtro adicional, o null.'),
        control_type: nullableStringProperty('Tipo como Button, Edit o MenuItem, o null.'),
        occurrence: { type: ['integer', 'null'], description: 'Índice base cero entre coincidencias ordenadas, o null para exigir coincidencia única.' },
      },
      required: ['name', 'automation_id', 'control_type', 'occurrence'], additionalProperties: false,
    }, strict: true,
  },
];
