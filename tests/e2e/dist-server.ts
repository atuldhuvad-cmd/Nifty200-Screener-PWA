import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, 'dist');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

/** Copies the real production build and gives it a distinguishable "release": a different title
 * and different JavaScript bytes, then regenerates sw.js so it is a genuinely new version. */
export function makeVariant(marker: string): string {
  if (!existsSync(join(DIST, 'sw.js'))) throw new Error('dist/sw.js missing: run npm run build');
  const dir = mkdtempSync(join(tmpdir(), `n200-${marker}-`));
  cpSync(DIST, dir, { recursive: true });
  const indexPath = join(dir, 'index.html');
  const html = readFileSync(indexPath, 'utf8').replace(
    /<title>[^<]*<\/title>/,
    `<title>Nifty 200 Screener (${marker})</title>`,
  );
  writeFileSync(indexPath, html);
  const script = readdirSync(join(dir, 'assets')).find((f) => f.endsWith('.js'));
  if (script === undefined) throw new Error('no script asset in dist');
  const scriptPath = join(dir, 'assets', script);
  writeFileSync(scriptPath, `${readFileSync(scriptPath, 'utf8')}\n/* release ${marker} */\n`);
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-sw.mjs'), dir]);
  return dir;
}

/** Every shell file in a build directory, as URL paths (`/index.html`), excluding sw.js itself. */
export function shellPaths(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (relative(dir, path) !== 'sw.js') {
        out.push(`/${relative(dir, path).split(sep).join('/')}`);
      }
    }
  };
  walk(dir);
  return out.sort();
}

export type Fault = '503' | 'html';

export interface TestServer {
  url: string;
  setRoot: (dir: string) => void;
  fail: (pathname: string, fault: Fault | null) => void;
  close: () => Promise<void>;
}

/** A tiny static server whose served build can be switched mid-test, to simulate a deploy. */
export async function startServer(initialRoot: string): Promise<TestServer> {
  let root = initialRoot;
  const faults = new Map<string, Fault>();
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    const fault = faults.get(pathname);
    if (fault === '503') {
      res.writeHead(503, { 'content-type': 'text/plain' }).end('unavailable');
      return;
    }
    if (fault === 'html') {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<html>fallback</html>');
      return;
    }
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = join(root, rel);
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res
      .writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-cache',
      })
      .end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no server address');
  return {
    url: `http://localhost:${String(address.port)}`,
    setRoot: (dir) => {
      root = dir;
    },
    fail: (pathname, fault) => {
      if (fault === null) faults.delete(pathname);
      else faults.set(pathname, fault);
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
