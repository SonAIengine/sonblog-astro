import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const home = process.env.HOME;
const userSystemdDir = resolve(home, ".config/systemd/user");
const runtimeDir = resolve(repoRoot, "search-service/runtime");
const statePath = resolve(runtimeDir, "active-backend.json");
const backendPorts = (process.env.SEARCH_BACKEND_PORTS ?? "8192,8194")
  .split(",")
  .map(port => Number.parseInt(port.trim(), 10))
  .filter(Number.isInteger);
const proxyPort = Number.parseInt(process.env.SEARCH_PROXY_PORT ?? "8182", 10);
const proxyUnit = "sonblog-search-proxy.service";
const legacyUnit = "sonblog-search.service";

if (backendPorts.length < 2) {
  throw new Error("SEARCH_BACKEND_PORTS must contain at least two ports");
}

async function run(command, args, options = {}) {
  const printable = [command, ...args].join(" ");
  try {
    const result = await execFile(command, args, {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024 * 4,
    });
    return result;
  } catch (error) {
    if (options.allowFail) {
      return {
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
        failed: true,
      };
    }
    error.message = `${printable}\n${error.message}\n${error.stderr ?? ""}`.trim();
    throw error;
  }
}

async function systemctl(args, options = {}) {
  return run("systemctl", ["--user", ...args], options);
}

async function isActive(unit) {
  const result = await systemctl(["is-active", "--quiet", unit], { allowFail: true });
  return !result.failed;
}

async function isEnabled(unit) {
  const result = await systemctl(["is-enabled", "--quiet", unit], { allowFail: true });
  return !result.failed;
}

async function fetchJson(url, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text.slice(0, 500) };
    }
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForBackend(port) {
  const deadline = Date.now() + Number.parseInt(process.env.SEARCH_DEPLOY_TIMEOUT_MS ?? "600000", 10);
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const health = await fetchJson(`http://127.0.0.1:${port}/health`);
      if (health.ok && health.data?.ok === true) {
        const smoke = await fetchJson(
          `http://127.0.0.1:${port}/search?q=${encodeURIComponent("KUPID MCP")}&limit=1`,
          8000
        );
        if (smoke.ok && Array.isArray(smoke.data?.results)) {
          return { health: health.data, smoke: smoke.data };
        }
        lastError = `smoke status=${smoke.status}`;
      } else {
        lastError = `health status=${health.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolveTimeout => setTimeout(resolveTimeout, 3000));
  }
  throw new Error(`Backend ${port} did not become ready: ${lastError}`);
}

async function waitForProxy() {
  const deadline = Date.now() + 30000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const health = await fetchJson(`http://127.0.0.1:${proxyPort}/health`);
      if (health.ok && health.data?.ok === true && health.data?.proxy?.ok === true) {
        return health.data;
      }
      lastError = `status=${health.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolveTimeout => setTimeout(resolveTimeout, 1000));
  }
  throw new Error(`Proxy did not become ready: ${lastError}`);
}

async function installUnits() {
  await mkdir(userSystemdDir, { recursive: true });
  const units = [proxyUnit, "sonblog-search-backend@.service"];
  for (const unit of units) {
    await copyFile(resolve(repoRoot, "ops/systemd", unit), resolve(userSystemdDir, unit));
  }
  await systemctl(["daemon-reload"]);
}

async function readActiveState() {
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeActiveState(port) {
  const commit = (await run("git", ["rev-parse", "--short", "HEAD"], { allowFail: true })).stdout?.trim();
  const payload = {
    port,
    backend: `http://127.0.0.1:${port}`,
    updatedAt: new Date().toISOString(),
    commit: commit || null,
  };
  await mkdir(runtimeDir, { recursive: true });
  const tmpPath = `${statePath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`);
  await rename(tmpPath, statePath);
  return payload;
}

async function main() {
  await installUnits();

  const previousState = await readActiveState();
  const previousPort = Number.parseInt(previousState?.port, 10);
  const nextPort =
    backendPorts.find(port => port !== previousPort) ??
    backendPorts.find(port => port !== proxyPort) ??
    backendPorts[0];
  const nextUnit = `sonblog-search-backend@${nextPort}.service`;
  const previousUnit = Number.isInteger(previousPort)
    ? `sonblog-search-backend@${previousPort}.service`
    : null;
  const legacyWasActive = await isActive(legacyUnit);
  const legacyWasEnabled = await isEnabled(legacyUnit);

  console.log(`Preparing search backend ${nextPort}...`);
  let backendReady;
  if (await isActive(nextUnit)) {
    try {
      backendReady = await waitForBackend(nextPort);
    } catch {
      console.log(`Backend ${nextPort} is active but not ready; restarting...`);
    }
  }
  if (!backendReady) {
    await systemctl(["restart", nextUnit]);
    backendReady = await waitForBackend(nextPort);
  }
  console.log(
    `Backend ${nextPort} ready: docs=${backendReady.health.docs}, aliases=${backendReady.health.aliases}`
  );

  const nextState = await writeActiveState(nextPort);
  console.log(`Active backend -> ${nextState.backend}`);

  if (!(await isActive(proxyUnit))) {
    if (legacyWasActive) {
      console.log(`Stopping legacy ${legacyUnit} to free port ${proxyPort}...`);
      await systemctl(["stop", legacyUnit]);
    }
    try {
      await systemctl(["start", proxyUnit]);
    } catch (error) {
      if (legacyWasActive) {
        await systemctl(["start", legacyUnit], { allowFail: true });
      }
      throw error;
    }
  }

  const proxyReady = await waitForProxy();
  console.log(`Proxy ready: backend=${proxyReady.proxy.backend}`);

  await systemctl(["enable", proxyUnit]);
  await systemctl(["enable", nextUnit]);

  if (previousUnit && previousPort !== nextPort) {
    await systemctl(["disable", "--now", previousUnit], { allowFail: true });
  }
  for (const port of backendPorts) {
    if (port !== nextPort && port !== previousPort) {
      await systemctl(["disable", "--now", `sonblog-search-backend@${port}.service`], {
        allowFail: true,
      });
    }
  }
  if (legacyWasActive || legacyWasEnabled) {
    await systemctl(["disable", legacyUnit], { allowFail: true });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        proxy: `http://127.0.0.1:${proxyPort}`,
        activeBackend: nextState,
        previousBackend: previousState,
      },
      null,
      2
    )
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
