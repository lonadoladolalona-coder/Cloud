import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import type { Context } from 'hono';

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac',
  svg: 'image/svg+xml',
};

export const mimeForPath = (file: string) => MIME[file.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

/**
 * Streams a file with HTTP Range support (browsers need 206 responses to seek inside <video>).
 * SVG is always served as an attachment-safe image with a sandboxing CSP so uploaded/generated
 * markup can never run script in this origin.
 */
export function serveFile(c: Context, file: string, opts: { download?: boolean; filename?: string } = {}): Response {
  const size = statSync(file).size;
  const type = mimeForPath(file);
  const headers = new Headers({ 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' });
  if (type === 'image/svg+xml') headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  if (opts.download) headers.set('Content-Disposition', `attachment; filename="${(opts.filename ?? 'download').replace(/[^\w.\- ]/g, '_')}"`);

  const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '');
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    } else {
      start = Math.max(0, size - Number(range[2]));
    }
    if (start > end || start >= size) {
      headers.set('Content-Range', `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    status = 206;
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  headers.set('Content-Length', String(size === 0 ? 0 : end - start + 1));
  if (size === 0) return new Response(null, { status, headers });
  const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
  return new Response(c.req.method === 'HEAD' ? null : stream, { status, headers });
}
