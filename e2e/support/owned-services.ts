import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export type E2eEndpoints = { baseUrl: string; mcpUrl: string };

type OwnedProcess = { child: ChildProcess; label: string; output: string[] };
type FileSnapshot = { bytes: Buffer | null; path: string };

const SERVICE_HEALTH_FETCH_TIMEOUT_MS = 5_000;

function resolveCorepackCommand(): string {
  const executable = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
  const bundledCorepack = join(dirname(process.execPath), executable);
  if (!existsSync(bundledCorepack)) {
    throw new Error(`Corepack executable was not found next to the active Node runtime: ${bundledCorepack}`);
  }
  return bundledCorepack;
}

const COREPACK_COMMAND = resolveCorepackCommand();

async function snapshotFile(path: string): Promise<FileSnapshot> {
  try {
    return { bytes: await readFile(path), path };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { bytes: null, path };
    }
    throw error;
  }
}

async function restoreFile(snapshot: FileSnapshot): Promise<void> {
  if (snapshot.bytes === null) {
    await rm(snapshot.path, { force: true });
    return;
  }
  await writeFile(snapshot.path, snapshot.bytes);
}

function portFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : fallback;
}

async function waitFor(url: string, label: string): Promise<void> {
  let lastError = 'not started';
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(SERVICE_HEALTH_FETCH_TIMEOUT_MS) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(250);
  }
  throw new Error(`${label} did not become ready at ${url}: ${lastError}`);
}

function start(label: string, args: string[], env: NodeJS.ProcessEnv): OwnedProcess {
  // Corepack reads this repository's packageManager field, pinning the command
  // to pnpm@10.15.0 without letting npx resolve a network package at runtime.
  const child = spawn(COREPACK_COMMAND, ['pnpm', ...args], {
    cwd: process.cwd(),
    detached: true,
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const output: string[] = [];
  child.stderr?.on('data', (chunk: Buffer) => {
    output.push(chunk.toString());
    if (output.length > 20) output.shift();
  });
  return { child, label, output };
}

async function runCommand(label: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const owned = start(label, args, env);
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    owned.child.once('error', reject);
    owned.child.once('exit', (code) => resolve(code));
  });
  if (exitCode !== 0) {
    throw new Error(`${label} exited ${exitCode ?? 'without a code'}: ${owned.output.join('').slice(-5_000)}`);
  }
}

async function stop(owned: OwnedProcess): Promise<void> {
  const pid = owned.child.pid;
  if (!pid || owned.child.exitCode !== null) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    owned.child.kill('SIGTERM');
  }
  await Promise.race([
    new Promise<void>((resolve) => owned.child.once('exit', () => resolve())),
    delay(5_000),
  ]);
  if (owned.child.exitCode === null) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      owned.child.kill('SIGKILL');
    }
  }
}

export async function withOwnedServices<T>(run: (endpoints: E2eEndpoints) => Promise<T>): Promise<T> {
  const externalBaseUrl = process.env.E2E_BASE_URL;
  const externalMcpUrl = process.env.E2E_MCP_URL;
  if (externalBaseUrl || externalMcpUrl) {
    if (!externalBaseUrl || !externalMcpUrl) {
      throw new Error('Set both E2E_BASE_URL and E2E_MCP_URL, or neither, when using external services.');
    }
    return run({ baseUrl: externalBaseUrl, mcpUrl: externalMcpUrl });
  }

  const webPort = portFromEnv('E2E_UX_WEB_PORT', 3303);
  const serverPort = portFromEnv('E2E_UX_SERVER_PORT', 4300);
  // This owned production stack is loopback-only. Keep one localhost origin in
  // the browser, server allowlist, and public runtime configuration.
  const baseUrl = `http://localhost:${webPort}`;
  const mcpUrl = `http://localhost:${serverPort}/mcp`;
  const dataDir = await mkdtemp(join(tmpdir(), 'arielcharts-ux-e2e-'));
  // `next build` rewrites this tracked generated declaration. Preserve any
  // caller state byte-for-byte instead of using Git to reset their worktree.
  const nextEnvSnapshot = await snapshotFile(join(process.cwd(), 'apps/web/next-env.d.ts'));
  const runtimeEnv = {
    ...process.env,
    ALLOWED_ORIGINS: baseUrl,
    DATA_DIR: dataDir,
    NEXT_PUBLIC_SERVER_URL: `http://localhost:${serverPort}`,
    NEXT_PUBLIC_WS_URL: `ws://localhost:${serverPort}`,
    PORT: String(serverPort),
  };
  const webEnv = { ...runtimeEnv, PORT: String(webPort) };
  let server: OwnedProcess | null = null;
  let web: OwnedProcess | null = null;

  try {
    // Screenshots are product evidence, so build and run production services.
    // This also keeps Next's development indicator out of the captures.
    await runCommand('production build', ['build'], webEnv);
    server = start('server', ['--filter', '@arielcharts/server', 'start'], runtimeEnv);
    web = start('web', ['--filter', '@arielcharts/web', 'start'], webEnv);
    await Promise.all([waitFor(`${baseUrl}/`, 'web'), waitFor(`http://localhost:${serverPort}/health`, 'server')]);
    return await run({ baseUrl, mcpUrl });
  } catch (error) {
    const diagnostics = [server, web]
      .filter((process): process is OwnedProcess => process !== null)
      .filter((process) => process.output.length > 0)
      .map((process) => `${process.label}: ${process.output.join('').slice(-3_000)}`)
      .join('\n');
    throw new Error(`${error instanceof Error ? error.message : String(error)}${diagnostics ? `\n${diagnostics}` : ''}`, { cause: error });
  } finally {
    await Promise.all([web, server].filter((process): process is OwnedProcess => process !== null).map(stop));
    await rm(dataDir, { force: true, recursive: true });
    await restoreFile(nextEnvSnapshot);
  }
}
