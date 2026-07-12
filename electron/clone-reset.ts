import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, mkdir, readFile, rename, rm, rmdir, unlink, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, parse, resolve } from 'node:path';
import { runtimeSecurityProductId, runtimeSecuritySchemaVersion, type ProtectedRuntimeBindingFile } from './runtime-security-core.js';

export const cloneResetArgument = '--df-clone-reset-plan=';
export const cloneResetRootName = 'maoyi Data';
const cloneResetLegacyRootName = 'maoyi';
const cloneResetPlanTtlMs = 5 * 60_000;
const cloneResetParentWaitMs = 15_000;
const cloneResetMarkerName = '.df-clone-reset-marker.json';

type CloneResetMarker = {
  schemaVersion: 1;
  productId: string;
  resetId: string;
  createdAt: number;
};

export type CloneResetPlan = {
  schemaVersion: 1;
  productId: string;
  resetId: string;
  targetRoot?: string;
  bootstrapPath?: string;
  runtimeBindingPaths: string[];
  expectedDataRootId?: string;
  expectedSuiteId?: string;
  parentProcessId: number;
  createdAt: number;
  expiresAt: number;
  uninstallerPath?: string;
};

function resetWorkRoot() {
  return join(tmpdir(), 'maoyi-Reset');
}

function samePath(left: string, right: string) {
  return normalize(resolve(left)).toLowerCase() === normalize(resolve(right)).toLowerCase();
}

function isOwnedDataRootPath(targetRoot: string) {
  const resolved = resolve(targetRoot);
  const parsed = parse(resolved);
  return Boolean(
    isAbsolute(resolved) &&
    !resolved.startsWith('\\\\') &&
    !samePath(resolved, parsed.root) &&
    [cloneResetRootName, cloneResetLegacyRootName].some(
      (name) => basename(resolved).toLowerCase() === name.toLowerCase()
    )
  );
}

async function writeAtomic(path: string, value: string) {
  const tempPath = `${path}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tempPath, value, 'utf8');
  try {
    await rename(tempPath, path);
  } catch (error) {
    await rm(path, { force: true });
    await rename(tempPath, path);
    void error;
  }
}

export function cloneResetPlanPathFromArgs(args = process.argv) {
  const arg = args.find((value) => value.startsWith(cloneResetArgument));
  return arg ? arg.slice(cloneResetArgument.length) : '';
}

export function cloneResetWorkerDataPath(planPath: string) {
  return join(resetWorkRoot(), `worker-${Buffer.from(planPath).toString('base64url').slice(-24)}`);
}

export async function createCloneResetPlan(input: {
  targetRoot?: string;
  bootstrapPath?: string;
  runtimeBindingPaths?: string[];
  expectedDataRootId?: string;
  expectedSuiteId?: string;
  parentProcessId?: number;
  uninstallerPath?: string;
}) {
  const now = Date.now();
  const resetId = randomUUID();
  const targetRoot = input.targetRoot ? resolve(input.targetRoot) : undefined;
  if (targetRoot) {
    if (!isOwnedDataRootPath(targetRoot)) {
      throw new Error('Clone-reset target is not an application-owned data root.');
    }
    const marker: CloneResetMarker = {
      schemaVersion: runtimeSecuritySchemaVersion,
      productId: runtimeSecurityProductId,
      resetId,
      createdAt: now
    };
    await writeAtomic(join(targetRoot, cloneResetMarkerName), `${JSON.stringify(marker)}\n`);
  }
  const plan: CloneResetPlan = {
    schemaVersion: runtimeSecuritySchemaVersion,
    productId: runtimeSecurityProductId,
    resetId,
    targetRoot,
    bootstrapPath: input.bootstrapPath ? resolve(input.bootstrapPath) : undefined,
    runtimeBindingPaths: [...new Set((input.runtimeBindingPaths || []).map((path) => resolve(path)))],
    expectedDataRootId: input.expectedDataRootId,
    expectedSuiteId: input.expectedSuiteId,
    parentProcessId: input.parentProcessId ?? process.pid,
    createdAt: now,
    expiresAt: now + cloneResetPlanTtlMs,
    uninstallerPath: input.uninstallerPath ? resolve(input.uninstallerPath) : undefined
  };
  const planPath = join(resetWorkRoot(), `reset-${resetId}.json`);
  await writeAtomic(planPath, `${JSON.stringify(plan)}\n`);
  return { plan, planPath };
}

async function processExists(processId: number) {
  if (!Number.isInteger(processId) || processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForParentExit(processId: number) {
  const deadline = Date.now() + cloneResetParentWaitMs;
  while (Date.now() < deadline && await processExists(processId)) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  if (await processExists(processId)) throw new Error('Clone-reset parent process did not exit.');
}

async function validateTargetRoot(plan: CloneResetPlan) {
  if (!plan.targetRoot) return;
  const targetRoot = resolve(plan.targetRoot);
  if (!isOwnedDataRootPath(targetRoot)) {
    throw new Error('Clone-reset target is not an application-owned data root.');
  }
  const rootStat = await lstat(targetRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('Clone-reset target root is not a normal directory.');
  }
  const marker = JSON.parse(await readFile(join(targetRoot, cloneResetMarkerName), 'utf8')) as CloneResetMarker;
  if (
    marker.schemaVersion !== runtimeSecuritySchemaVersion ||
    marker.productId !== runtimeSecurityProductId ||
    marker.resetId !== plan.resetId
  ) {
    throw new Error('Clone-reset marker validation failed.');
  }
  if (plan.expectedDataRootId || plan.expectedSuiteId) {
    const binding = JSON.parse(await readFile(join(targetRoot, 'runtime-binding.dat'), 'utf8')) as ProtectedRuntimeBindingFile;
    if (
      binding.schemaVersion !== runtimeSecuritySchemaVersion ||
      binding.productId !== runtimeSecurityProductId ||
      (plan.expectedDataRootId && binding.dataRootId !== plan.expectedDataRootId) ||
      (plan.expectedSuiteId && binding.suiteId !== plan.expectedSuiteId)
    ) {
      throw new Error('Clone-reset runtime binding validation failed.');
    }
  }
}

async function retryDelete(operation: () => Promise<void>) {
  const delays = [0, 250, 500, 1_000, 2_000, 4_000, 8_000];
  let lastError: unknown;
  for (const delay of delays) {
    if (delay) await new Promise((resolvePromise) => setTimeout(resolvePromise, delay));
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function removeTreeWithoutFollowingLinks(path: string) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    if (entry.isSymbolicLink()) {
      await retryDelete(() => unlink(entryPath).catch(async () => rm(entryPath, { force: true })));
    } else if (entry.isDirectory()) {
      await removeTreeWithoutFollowingLinks(entryPath);
    } else {
      await retryDelete(() => rm(entryPath, { force: true }));
    }
  }
  await retryDelete(() => rmdir(path));
}

async function removeBootstrapIfOwned(path: string | undefined, targetRoot: string | undefined) {
  if (!path || !targetRoot) return;
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { dataPath?: unknown };
    if (typeof parsed.dataPath !== 'string' || !samePath(parsed.dataPath, targetRoot)) return;
    await rm(path, { force: true });
    await rmdir(dirname(path)).catch(() => undefined);
  } catch {
    // A missing or unrelated bootstrap pointer must not broaden reset scope.
  }
}

export async function runCloneResetWorker(planPath: string) {
  const resolvedPlanPath = resolve(planPath);
  if (!samePath(dirname(resolvedPlanPath), resetWorkRoot())) throw new Error('Clone-reset plan path is invalid.');
  const plan = JSON.parse(await readFile(resolvedPlanPath, 'utf8')) as CloneResetPlan;
  if (
    plan.schemaVersion !== runtimeSecuritySchemaVersion ||
    plan.productId !== runtimeSecurityProductId ||
    !plan.resetId ||
    Date.now() > plan.expiresAt ||
    plan.expiresAt - plan.createdAt !== cloneResetPlanTtlMs
  ) {
    throw new Error('Clone-reset plan is invalid or expired.');
  }
  await validateTargetRoot(plan);
  await waitForParentExit(plan.parentProcessId);
  if (plan.targetRoot) await removeTreeWithoutFollowingLinks(resolve(plan.targetRoot));
  await removeBootstrapIfOwned(plan.bootstrapPath, plan.targetRoot);
  for (const bindingPath of plan.runtimeBindingPaths) {
    if (basename(bindingPath).toLowerCase() !== 'df-runtime-binding.dat') continue;
    try {
      const binding = JSON.parse(await readFile(bindingPath, 'utf8')) as ProtectedRuntimeBindingFile;
      if (
        binding.productId === runtimeSecurityProductId &&
        (!plan.expectedDataRootId || binding.dataRootId === plan.expectedDataRootId)
      ) {
        await rm(bindingPath, { force: true });
      }
    } catch {
      // Missing or unrelated runtime sidecars are ignored.
    }
  }
  if (
    plan.uninstallerPath &&
    basename(plan.uninstallerPath).toLowerCase() === 'uninstall maoyi translator.exe' &&
    samePath(dirname(plan.uninstallerPath), dirname(process.execPath))
  ) {
    try {
      const uninstaller = spawn(plan.uninstallerPath, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true });
      uninstaller.unref();
    } catch {
      // The permanent machine lock remains active even if Windows cannot finish uninstalling immediately.
    }
  }
  await rm(resolvedPlanPath, { force: true });
  await rmdir(dirname(resolvedPlanPath)).catch(() => undefined);
  return { resetId: plan.resetId, removedRoot: Boolean(plan.targetRoot) };
}
