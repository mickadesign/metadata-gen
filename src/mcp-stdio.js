// `metadata-gen mcp`: the process an agent's MCP config points at. It proxies
// stdio JSON-RPC to the running preview server for this project. When none is
// running it starts one in-process (without opening a browser) so the agent
// still gets tools; the user can open the preview URL from get_project.

import { readLockfile, lockfileIsLive } from './lockfile.js';
import { proxyStdio } from './mcp.js';

export async function runMcpShim({ root = process.cwd() } = {}) {
  const log = (msg) => process.stderr.write(`${msg}\n`);
  let info = await readLockfile(root);
  let ownServer = null;
  if (!(await lockfileIsLive(info))) {
    log('metadata-gen mcp: no preview server running, starting one');
    const { startServer } = await import('./server.js');
    const handle = await startServer({ root, open: false, log: () => {}, registerSignals: false });
    info = { url: handle.url, token: handle.token };
    ownServer = handle;
  } else {
    log(`metadata-gen mcp: using preview server at ${info.url}`);
  }
  try {
    await proxyStdio({ url: info.url, token: info.token, log });
  } finally {
    if (ownServer) await ownServer.close();
  }
}
