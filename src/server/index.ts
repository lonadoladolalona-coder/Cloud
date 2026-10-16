import path from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
const dataDir = path.resolve(process.env.H3_DATA_DIR ?? 'data');
const devOrigin = process.env.H3_DEV_ORIGIN ?? 'http://localhost:5173';

const { app, queue } = createApp({
  dataDir,
  port,
  extraOrigins: [devOrigin, devOrigin.replace('localhost', '127.0.0.1')],
  webRoot: path.resolve('dist/web'),
});

const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`Studio H3 listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${info.port}`);
  console.log(`Data directory: ${dataDir}`);
  if (host !== '127.0.0.1' && host !== 'localhost') {
    console.warn('WARNING: HOST is not loopback. The API can run programs you configure; only expose it on a network you trust.');
  }
});

const shutdown = () => {
  server.close();
  queue.cancelAll();
  void queue.idle().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 6000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
