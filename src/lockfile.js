// The preview server records where it is listening so `metadata-gen mcp` can
// find it. Kept in the OS temp dir, keyed by project root, so nothing is
// written into the user's project.

import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { realpathSync } from 'node:fs';

/**
 * Key the lockfile by the project's real path so a symlinked cwd (macOS
 * /var vs /private/var, an IDE passing an alias) still finds the same file.
 */
export function lockfilePath(root) {
  let resolved = root;
  try { resolved = realpathSync(root); } catch { /* keep as given */ }
  const key = createHash('sha1').update(resolved).digest('hex').slice(0, 16);
  return join(tmpdir(), 'metadata-gen', `${key}.json`);
}

export async function writeLockfile(root, info) {
  const path = lockfilePath(root);
  await mkdir(join(tmpdir(), 'metadata-gen'), { recursive: true });
  await writeFile(path, JSON.stringify({ root, ...info }, null, 2), { mode: 0o600 });
  return path;
}

export async function readLockfile(root) {
  try {
    return JSON.parse(await readFile(lockfilePath(root), 'utf-8'));
  } catch {
    return null;
  }
}

export async function removeLockfile(root) {
  try {
    await unlink(lockfilePath(root));
  } catch {
    // already gone
  }
}

function realRoot(root) {
  try { return realpathSync(root); } catch { return root; }
}

/**
 * True when the server the lockfile points at is the one that wrote it:
 * it must accept this token and report the same project root. A port
 * reused by another metadata-gen instance fails both checks.
 */
export async function lockfileIsLive(info) {
  if (!info || !info.url || !info.token || !info.root) return false;
  try {
    const res = await fetch(`${info.url}/api/health`, {
      headers: { 'X-Metadata-Gen-Token': info.token },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return false;
    const body = await res.json();
    return !!body && body.ok === true && typeof body.root === 'string' && realRoot(body.root) === realRoot(info.root);
  } catch {
    return false;
  }
}
