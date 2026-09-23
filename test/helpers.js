import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A throwaway project with a metadata.config.json the server can load. */
export async function makeProject(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'metadata-gen-test-'));
  const config = {
    title: 'Test Project',
    tagline: 'A tagline for tests',
    colors: { background: '#0f0f0f', foreground: '#ffffff', accent: '#888888' },
    logo: null,
    faviconSrc: null,
    outputDir: 'public/metadata',
    font: 'Inter',
    url: 'https://example.com',
    ...overrides,
  };
  await writeFile(join(root, 'metadata.config.json'), JSON.stringify(config, null, 2));
  await mkdir(join(root, 'public'), { recursive: true });
  return { root, config };
}

export function jsonHeaders(token, extra = {}) {
  return { 'Content-Type': 'application/json', 'X-Metadata-Gen-Token': token, ...extra };
}
