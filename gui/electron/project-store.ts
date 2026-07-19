import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  MAX_PROJECT_BYTES,
  assertProjectDocument,
  assertRecoverySnapshot,
  parseProjectText,
  sidecarPathForVideo,
  type ProjectDocumentV1,
  type ProjectOpenResult,
  type ProjectSaveResult,
  type RecoverySnapshot,
  type SourceIdentity,
} from "./project-schema.js";

const FINGERPRINT_BYTES = 1024 * 1024;

export function projectPathForVideo(videoPath: string) {
  return sidecarPathForVideo(path.resolve(videoPath));
}

export async function loadProject(projectPath: string): Promise<ProjectOpenResult> {
  ensureProjectExtension(projectPath);
  const candidates: Array<{ candidatePath: string; recoveredFrom: ProjectOpenResult["recoveredFrom"] }> = [
    { candidatePath: projectPath, recoveredFrom: "target" },
    { candidatePath: `${projectPath}.tmp`, recoveredFrom: "temporary" },
    { candidatePath: `${projectPath}.bak`, recoveredFrom: "backup" },
  ];
  const valid: Array<{ document: ProjectDocumentV1; recoveredFrom: ProjectOpenResult["recoveredFrom"] }> = [];
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      valid.push({ document: await readProject(candidate.candidatePath), recoveredFrom: candidate.recoveredFrom });
    } catch (error) {
      if (candidate.recoveredFrom === "target" && String(error).includes("newer version of songcut")) {
        throw error;
      }
      if (await fileExists(candidate.candidatePath)) errors.push(`${candidate.recoveredFrom}: ${String(error)}`);
    }
  }
  if (!valid.length) {
    throw new Error(errors.length ? `No valid songcut project was found (${errors.join("; ")})` : `Project not found: ${projectPath}`);
  }
  valid.sort((left, right) => right.document.revision - left.document.revision || Date.parse(right.document.updated_at) - Date.parse(left.document.updated_at));
  return { projectPath, document: valid[0].document, recoveredFrom: valid[0].recoveredFrom };
}

export async function saveProject(projectPath: string, document: ProjectDocumentV1): Promise<ProjectSaveResult> {
  ensureProjectExtension(projectPath);
  assertProjectDocument(document);
  await atomicWriteJson(projectPath, document, (value) => assertProjectDocument(value));
  return { projectPath, revision: document.revision, savedAt: new Date().toISOString() };
}

export function recoveryPath(userDataPath: string) {
  return path.join(userDataPath, "recovery", "active.json");
}

export async function loadRecovery(userDataPath: string): Promise<RecoverySnapshot | null> {
  const target = recoveryPath(userDataPath);
  if (!(await fileExists(target))) return null;
  const raw = await readJsonLimited(target);
  assertRecoverySnapshot(raw);
  return raw;
}

export async function saveRecovery(userDataPath: string, snapshot: RecoverySnapshot): Promise<void> {
  assertRecoverySnapshot(snapshot);
  await atomicWriteJson(recoveryPath(userDataPath), snapshot, (value) => assertRecoverySnapshot(value));
}

export async function clearRecovery(userDataPath: string): Promise<void> {
  const target = recoveryPath(userDataPath);
  await rm(target, { force: true });
  await rm(`${target}.tmp`, { force: true });
  await rm(`${target}.bak`, { force: true });
}

export async function fingerprintSource(filePath: string): Promise<SourceIdentity> {
  const resolved = path.resolve(filePath);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error(`Source is not a file: ${filePath}`);
  const handle = await open(resolved, "r");
  try {
    const headLength = Math.min(FINGERPRINT_BYTES, info.size);
    const tailStart = Math.max(0, info.size - FINGERPRINT_BYTES);
    const tailLength = Math.min(FINGERPRINT_BYTES, info.size - tailStart);
    const head = Buffer.alloc(headLength);
    const tail = Buffer.alloc(tailLength);
    if (headLength) await handle.read(head, 0, headLength, 0);
    if (tailLength) await handle.read(tail, 0, tailLength, tailStart);
    const hash = createHash("sha256");
    hash.update(Buffer.from(String(info.size), "utf8"));
    hash.update(Buffer.from([0]));
    hash.update(head);
    hash.update(Buffer.from([0]));
    hash.update(tail);
    return {
      path: resolved,
      filename: path.basename(resolved),
      size_bytes: info.size,
      mtime_ms: info.mtimeMs,
      fingerprint: { algorithm: "sha256-head-tail-1m-v1", value: hash.digest("hex") },
    };
  } finally {
    await handle.close();
  }
}

export async function findProjectSource(projectPath: string, document: ProjectDocumentV1): Promise<string | null> {
  const candidates = [
    document.source.absolute_path,
    path.resolve(path.dirname(projectPath), document.source.relative_path || document.source.filename),
  ];
  for (const candidate of [...new Set(candidates)]) {
    try {
      const identity = await fingerprintSource(candidate);
      if (sourceIdentityMatches(document, identity)) return identity.path;
    } catch {
      // Continue with the next deterministic candidate.
    }
  }
  return null;
}

export function sourceIdentityMatches(document: ProjectDocumentV1, identity: SourceIdentity) {
  return document.source.size_bytes === identity.size_bytes && document.source.fingerprint.value === identity.fingerprint.value;
}

export async function archiveRelinkedProject(projectPath: string): Promise<string | null> {
  if (!(await fileExists(projectPath))) return null;
  let candidate = `${projectPath}.relinked.bak`;
  let suffix = 2;
  while (await fileExists(candidate)) candidate = `${projectPath}.relinked-${suffix++}.bak`;
  await rename(projectPath, candidate);
  return candidate;
}

export async function archiveConflict(filePath: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const candidate = `${filePath}.conflict-${stamp}`;
  await rename(filePath, candidate);
  return candidate;
}

async function atomicWriteJson(target: string, value: unknown, validate: (value: unknown) => void) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  const backup = `${target}.bak`;
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(text, "utf8") > MAX_PROJECT_BYTES) throw new Error("Project exceeds the 64 MiB limit.");

  await rm(temporary, { force: true });
  const handle = await open(temporary, "w");
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  validate(await readJsonLimited(temporary));

  const hadTarget = await fileExists(target);
  if (hadTarget) {
    await rm(backup, { force: true });
    await rename(target, backup);
  }
  try {
    await rename(temporary, target);
    validate(await readJsonLimited(target));
    await rm(backup, { force: true });
  } catch (error) {
    await rm(target, { force: true });
    if (hadTarget && (await fileExists(backup))) await rename(backup, target);
    throw error;
  }
}

async function readProject(projectPath: string) {
  const text = await readTextLimited(projectPath);
  return parseProjectText(text);
}

async function readJsonLimited(filePath: string): Promise<unknown> {
  return JSON.parse(await readTextLimited(filePath)) as unknown;
}

async function readTextLimited(filePath: string) {
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error(`Not a file: ${filePath}`);
  if (info.size > MAX_PROJECT_BYTES) throw new Error("Project exceeds the 64 MiB limit.");
  return readFile(filePath, "utf8");
}

async function fileExists(filePath: string) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function ensureProjectExtension(projectPath: string) {
  if (!projectPath.toLowerCase().endsWith(".songcut")) throw new Error("Project files must use the .songcut extension.");
}
