import type { MiddlewareHandler } from 'hono';

/**
 * This is a local tool whose settings can name a program to run, so the API must only be
 * reachable by the UI served from this very server:
 *  - Host allow-list stops DNS-rebinding (a hostile page resolving its own name to 127.0.0.1).
 *  - Origin check on non-GET requests stops cross-site request forgery from other open tabs.
 */
export function localOnly(port: number, extraOrigins: string[] = []): MiddlewareHandler {
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, 'localhost', '127.0.0.1']);
  const origins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`, ...extraOrigins]);
  return async (c, next) => {
    const host = c.req.header('host') ?? '';
    const devHost = extraOrigins.some((o) => new URL(o).host === host);
    if (!hosts.has(host) && !devHost) return c.json({ error: 'Unexpected Host header.' }, 403);

    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const origin = c.req.header('origin');
      if (!origin || !origins.has(origin)) return c.json({ error: 'Cross-origin request blocked.' }, 403);
    }
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Frame-Options', 'DENY');
  };
}
