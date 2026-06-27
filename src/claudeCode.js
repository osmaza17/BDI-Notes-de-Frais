// ---------------------------------------------------------------------------
// Motor por DEFECTO de la app: instancias HEADLESS de Claude Code (`claude -p`).
//
// En vez de llamar a la API de Anthropic (clave de pago), se lanza el CLI de
// Claude Code ya instalado y LOGUEADO en el ordenador, usando su SUSCRIPCIÓN.
// Patrón replicado de los proyectos del usuario (youtube-summarizer /
// linkedin-summarizer), adaptado a Node y a entradas con documentos:
//
//   • Invocación: `claude -p --model <alias> --output-format json`.
//   • Prompt por STDIN (nunca por argv: en Windows hay límite de longitud de
//     la línea de comandos y el prompt + esquema pueden ser largos).
//   • Ventana INVISIBLE en Windows: `windowsHide: true` (equivale al
//     CREATE_NO_WINDOW de la referencia). Si el binario es un `.cmd`/`.ps1`
//     se invoca vía `cmd.exe /c` (también con windowsHide) para no abrir
//     consola; un `.exe` se lanza directo.
//   • Forzar SUSCRIPCIÓN, no API: se borran ANTHROPIC_API_KEY y
//     ANTHROPIC_AUTH_TOKEN del entorno del hijo (si las hereda, el CLI
//     facturaría la API en vez de usar la suscripción).
//   • cwd = carpeta TEMPORAL vacía para que Claude Code no cargue el CLAUDE.md
//     del proyecto. Los documentos a leer se COPIAN dentro de ese cwd y la
//     instancia los lee con su herramienta `Read` (soporta PDF e imágenes),
//     pre-autorizada con `--allowedTools Read` y acotada con `--max-turns`.
//
// Todo es portable: solo módulos de Node, rutas relativas, sin binarios extra.
// ---------------------------------------------------------------------------
import { spawn, execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ES_WIN = process.platform === 'win32';

// Error recuperable del motor Claude Code. `tipo` lo traduce el frontend a un
// mensaje claro + cómo resolverlo (ver `clasificarErrorIA` y app.js).
//   claude_code_falta   → el CLI `claude` no está instalado / no está en el PATH
//   claude_code_auth    → el CLI no está logueado (claude login)
//   claude_code_timeout → la llamada tardó demasiado
//   claude_code_salida  → respuesta vacía / no-JSON / sin texto
//   claude_code_error   → cualquier otro fallo del CLI
export class ErrorClaudeCode extends Error {
  constructor(mensaje, tipo = 'claude_code_error') {
    super(mensaje);
    this.name = 'ErrorClaudeCode';
    this.tipo = tipo;
  }
}

// Resuelve la ruta del binario `claude` UNA vez (cache). En Windows usa `where`
// (toma la 1ª línea), en el resto `which`. Devuelve la ruta absoluta o null.
let _rutaClaude;
export function rutaClaude() {
  if (_rutaClaude !== undefined) return _rutaClaude;
  try {
    const cmd = ES_WIN ? 'where' : 'which';
    const salida = execFileSync(cmd, ['claude'], { encoding: 'utf8', windowsHide: true });
    _rutaClaude = (salida.split(/\r?\n/).find((l) => l.trim()) || '').trim() || null;
  } catch {
    _rutaClaude = null;
  }
  return _rutaClaude;
}

export function claudeDisponible() {
  return !!rutaClaude();
}

// Versión del CLI (para mostrarla en Réglages). null si no se puede obtener.
let _version;
export function versionClaude() {
  if (_version !== undefined) return _version;
  const exe = rutaClaude();
  if (!exe) return (_version = null);
  try {
    const salida = execFileSync(exe, ['--version'], { encoding: 'utf8', windowsHide: true });
    _version = (salida.match(/[\d.]+/)?.[0]) || salida.trim() || null;
  } catch {
    _version = null;
  }
  return _version;
}

// Mapea el id de modelo de la API al alias que entiende el CLI de Claude Code.
export function aliasModelo(modelo) {
  const m = (modelo || '').toLowerCase();
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('opus')) return 'opus';
  return 'haiku';
}

// Entorno del hijo SIN las credenciales de API → fuerza el uso de la suscripción.
function entornoSinClaves() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

// Extrae un objeto/array JSON de una respuesta del modelo de forma tolerante:
// quita fences ```json … ```, recorta hasta el primer { o [ y su cierre. El CLI
// no fuerza json_schema (a diferencia de la API), así que el modelo a veces
// envuelve el JSON en texto/markdown; esto lo recupera.
export function parsearJSONlax(txt) {
  if (txt == null) throw new ErrorClaudeCode('Respuesta vacía del modelo.', 'claude_code_salida');
  let s = String(txt).trim();
  // ```json ... ```  ó  ``` ... ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    // Recorta al primer bloque { … } o [ … ] equilibrado por extremos.
    const ini = s.search(/[[{]/);
    const fin = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (ini !== -1 && fin > ini) {
      try { return JSON.parse(s.slice(ini, fin + 1)); } catch { /* cae abajo */ }
    }
    throw new ErrorClaudeCode('La respuesta del modelo no es JSON válido.', 'claude_code_salida');
  }
}

// Heurística: ¿el error del CLI huele a falta de sesión / login?
function pareceAuth(texto) {
  return /login|log ?in|logged|unauthori|not authenticated|authentication|sign ?in|credential|invalid api key/i.test(texto || '');
}

// Lanza una instancia headless de Claude Code y devuelve el TEXTO de la respuesta
// del modelo (campo `result` del envelope `--output-format json`).
//
//   prompt       texto completo (system + contexto + esquema) → va por stdin
//   modelo       id de modelo de la API (se mapea a alias del CLI)
//   ficheros     [{ nombre, ruta }] o [{ nombre, base64 }] a COPIAR en el cwd
//                temporal para que la instancia los lea con `Read`
//   permitirRead si hay ficheros, pre-autoriza la herramienta Read
//   timeout      ms antes de matar el proceso (def. 600000)
//   onLog        callback de log opcional (Journal d'analyse)
export async function ejecutarClaude({ prompt, modelo, ficheros = [], permitirRead = false, timeout = 600000, onLog } = {}) {
  const exe = rutaClaude();
  if (!exe) throw new ErrorClaudeCode("Claude Code (`claude`) introuvable dans le PATH.", 'claude_code_falta');

  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ndf-cc-'));
  try {
    // Copia los documentos a leer dentro del cwd temporal (aislado, sin CLAUDE.md).
    for (const f of ficheros) {
      const destino = path.join(cwd, f.nombre);
      if (f.base64 != null) await fs.writeFile(destino, Buffer.from(f.base64, 'base64'));
      else await fs.copyFile(f.ruta, destino);
    }

    // Flags de RENDIMIENTO (cada `claude -p` arranca un proceso nuevo): se ignoran los MCP
    // globales del usuario (`--strict-mcp-config` sin `--mcp-config`) y no se cargan settings,
    // hooks, skills ni plugins (`--setting-sources ''`). La sesión de suscripción/login se
    // mantiene igual. `--tools` limita el set de herramientas (Read para leer un documento;
    // ninguna para los pasos de solo texto), lo que reduce arranque y tokens.
    const args = [
      '-p', '--model', aliasModelo(modelo), '--output-format', 'json',
      '--strict-mcp-config', '--setting-sources', '',
    ];
    if (permitirRead) args.push('--tools', 'Read', '--allowedTools', 'Read', '--max-turns', '6');
    else args.push('--tools', '');

    onLog?.(`⏳ Claude Code (modèle ${aliasModelo(modelo)})…`);
    const { stdout } = await spawnClaude(exe, args, { cwd, prompt, timeout });

    const out = (stdout || '').trim();
    if (!out) throw new ErrorClaudeCode('Sortie vide du CLI Claude Code.', 'claude_code_salida');

    let data;
    try { data = JSON.parse(out); }
    catch { throw new ErrorClaudeCode('La sortie du CLI n’est pas du JSON valide.', 'claude_code_salida'); }

    if (data.is_error) {
      const m = data.result || data.subtype || 'erreur inconnue';
      throw new ErrorClaudeCode(`Claude Code a renvoyé une erreur : ${m}`, pareceAuth(m) ? 'claude_code_auth' : 'claude_code_error');
    }
    const result = (data.result || '').trim();
    if (!result) throw new ErrorClaudeCode('Le CLI Claude Code n’a renvoyé aucun texte.', 'claude_code_salida');
    return result;
  } finally {
    fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}

// Envoltorio de spawn: prompt por stdin, captura stdout/stderr, ventana oculta,
// entorno sin claves, timeout con kill. Resuelve {stdout} o rechaza ErrorClaudeCode.
function spawnClaude(exe, args, { cwd, prompt, timeout }) {
  return new Promise((resolve, reject) => {
    const ext = path.extname(exe).toLowerCase();
    // Un .exe se lanza directo; un .cmd/.bat/.ps1 se envuelve en cmd.exe para que
    // windowsHide oculte la consola (Node no ejecuta .cmd sin shell).
    let cmd = exe, finalArgs = args;
    if (ES_WIN && (ext === '.cmd' || ext === '.bat' || ext === '.ps1')) {
      cmd = process.env.ComSpec || 'cmd.exe';
      finalArgs = ['/d', '/s', '/c', exe, ...args];
    }

    let hijo;
    try {
      hijo = spawn(cmd, finalArgs, {
        cwd,
        windowsHide: true,
        env: entornoSinClaves(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      return reject(new ErrorClaudeCode(`Impossible de lancer le CLI : ${e.message}`, 'claude_code_error'));
    }

    let stdout = '', stderr = '', acabado = false;
    const fin = (fn) => { if (!acabado) { acabado = true; clearTimeout(t); fn(); } };
    const t = setTimeout(() => {
      try { hijo.kill('SIGKILL'); } catch { /* ya muerto */ }
      fin(() => reject(new ErrorClaudeCode(`Timeout après ${Math.round(timeout / 1000)}s.`, 'claude_code_timeout')));
    }, timeout);

    hijo.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    hijo.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    hijo.on('error', (e) => fin(() => reject(new ErrorClaudeCode(`Impossible de lancer le CLI : ${e.message}`, 'claude_code_error'))));
    hijo.on('close', (code) => {
      if (code === 0) return fin(() => resolve({ stdout }));
      const msg = (stderr || stdout || '').trim().slice(0, 300);
      const tipo = pareceAuth(msg) ? 'claude_code_auth' : 'claude_code_error';
      fin(() => reject(new ErrorClaudeCode(`exit ${code}: ${msg}`, tipo)));
    });

    // Prompt por stdin.
    try { hijo.stdin.write(prompt); hijo.stdin.end(); }
    catch { /* el proceso ya pudo cerrarse; 'error'/'close' lo gestionan */ }
  });
}
