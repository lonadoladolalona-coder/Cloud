import { spawn } from 'node:child_process';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Backend, BackendContext, BackendResult } from './types';

const VIDEO_OUT = /^output\.(mp4|webm|mov|m4v)$/i;
const POSTER_OUT = /^poster\.(jpg|jpeg|png|webp)$/i;

/**
 * Runs the configured program once per job. It is started directly (never through a shell) so
 * prompt text can't be interpreted as commands; everything reaches it through files and env vars:
 *
 *   H3_JOB_DIR     working folder for this job
 *   H3_JOB_JSON    job.json  — { id, mode, prompt, params, assets:[{label,kind,role,path,filename,mime,note}] }
 *   H3_PROMPT_FILE prompt.txt — the final structured prompt text
 *   H3_OUTPUT      where to write the video (<job dir>/output.mp4)
 *
 * stdout lines "PROGRESS <0-100> [message]" or {"progress":0.0-1.0,"message":"…"} update the UI.
 * Exit code 0 plus an output.(mp4|webm|mov|m4v) file in the job folder means success.
 */
export function createCommandBackend(): Backend {
  return {
    async run(ctx: BackendContext): Promise<BackendResult> {
      const { command, dir, job } = ctx;
      if (!command.program) throw new Error('No program configured. Set one under Settings → Generation.');

      const jobJson = path.join(dir, 'job.json');
      const promptFile = path.join(dir, 'prompt.txt');
      const output = path.join(dir, 'output.mp4');
      await writeFile(promptFile, job.prompt);
      await writeFile(
        jobJson,
        JSON.stringify(
          {
            id: job.id,
            mode: job.mode,
            prompt: job.prompt,
            params: job.params,
            assets: ctx.inputs.map(({ label, kind, role, path: p, filename, mime, note }) => ({ label, kind, role, path: p, filename, mime, note })),
          },
          null,
          2,
        ),
      );

      await new Promise<void>((resolve, reject) => {
        const child = spawn(command.program, command.args, {
          cwd: command.cwd || dir,
          env: { ...process.env, ...command.env, H3_JOB_DIR: dir, H3_JOB_JSON: jobJson, H3_PROMPT_FILE: promptFile, H3_OUTPUT: output },
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        });

        let settled = false;
        const finish = (err?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          ctx.signal.removeEventListener('abort', onAbort);
          err ? reject(err) : resolve();
        };
        const killGroup = (sig: NodeJS.Signals) => {
          try {
            if (child.pid) process.kill(-child.pid, sig);
          } catch {
            /* already gone */
          }
        };
        const onAbort = () => {
          killGroup('SIGTERM');
          setTimeout(() => killGroup('SIGKILL'), 5000).unref();
          finish(new Error('cancelled'));
        };
        const timer = setTimeout(() => {
          killGroup('SIGTERM');
          setTimeout(() => killGroup('SIGKILL'), 5000).unref();
          finish(new Error(`Timed out after ${command.timeoutMin} minutes.`));
        }, command.timeoutMin * 60_000);
        if (ctx.signal.aborted) return onAbort();
        ctx.signal.addEventListener('abort', onAbort, { once: true });

        const lineReader = (stream: NodeJS.ReadableStream, isErr: boolean) => {
          let buffer = '';
          stream.setEncoding?.('utf8');
          stream.on('data', (chunk: string) => {
            buffer += chunk;
            let nl: number;
            while ((nl = buffer.indexOf('\n')) >= 0) {
              handleLine(buffer.slice(0, nl).replace(/\r$/, ''), isErr);
              buffer = buffer.slice(nl + 1);
            }
          });
          stream.on('end', () => buffer && handleLine(buffer, isErr));
        };
        const handleLine = (line: string, isErr: boolean) => {
          if (!line.trim()) return;
          const pct = /^PROGRESS\s+(\d+(?:\.\d+)?)\s*(.*)$/.exec(line);
          if (pct) return ctx.progress(Math.min(1, Number(pct[1]) / 100), pct[2] || undefined);
          if (line.startsWith('{')) {
            try {
              const j = JSON.parse(line) as { progress?: number; message?: string };
              if (typeof j.progress === 'number') return ctx.progress(j.progress > 1 ? Math.min(1, j.progress / 100) : j.progress, j.message);
            } catch {
              /* not a progress line */
            }
          }
          ctx.log(isErr ? `! ${line}` : line);
        };
        lineReader(child.stdout!, false);
        lineReader(child.stderr!, true);

        child.on('error', (e) => finish(new Error(`Could not start "${command.program}": ${e.message}`)));
        child.on('close', (code, signal) => {
          if (code === 0) finish();
          else finish(new Error(signal ? `Process was killed by ${signal}.` : `Process exited with code ${code}.`));
        });
      });

      const files = await readdir(dir);
      const video = files.find((f) => VIDEO_OUT.test(f));
      if (!video) throw new Error('The program finished successfully but wrote no output.(mp4|webm|mov|m4v) file to $H3_JOB_DIR.');
      return { video, poster: files.find((f) => POSTER_OUT.test(f)) };
    },
  };
}
