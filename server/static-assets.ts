import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';

/** Register static UI routes. Static HTML never receives process credentials. */
export function registerStaticAssets(app: Hono, distPath: string): void {
  app.get('*', (c) => {
    const url = new URL(c.req.url);
    let filePath = join(distPath, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!existsSync(filePath)) filePath = join(distPath, 'index.html');
    if (filePath.endsWith('.html')) {
      c.header('Cache-Control', 'no-store');
      return c.html(readFileSync(filePath, 'utf-8'));
    }
    const content = readFileSync(filePath);
    const ext = filePath.split('.').pop() ?? '';
    const mimeTypes: Record<string, string> = {
      js: 'application/javascript',
      css: 'text/css',
      svg: 'image/svg+xml',
      png: 'image/png',
      ico: 'image/x-icon',
      woff2: 'font/woff2',
    };
    c.header('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    return c.body(content);
  });
}
