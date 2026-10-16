# Studio H3

A local, Higgsfield-style prompt studio for **Minimax H3**. You describe a scene in plain words, attach reference images, video or audio, and the app produces the **official structured H3 prompt** (the format in the vendored writing guides). It then queues generation on your local model.

```
rough idea + assets ──► Claude (fills a JSON schema) ──► deterministic compiler ──► exact H3 prompt ──► your local H3
```

The point is that the output **format cannot drift**. Claude only fills a structured form (shots, timecodes, dialogue, soundscape, music, subject definitions, retention markers). A deterministic compiler assembles the final text, and a linter checks it against the guide's rules.

## Quick start

Requires Node 20 or newer.

```bash
npm install
npm run build
npm start            # http://127.0.0.1:8787
```

Development with hot reload: `npm run dev` (Vite on :5173, API on :8787).

### Claude API key (for "Enhance")

Any one of these works:

1. Paste it in **Settings** (stored in `data/settings.json`, mode 0600, and never sent back to the browser).
2. Set `ANTHROPIC_API_KEY` in the environment.
3. Log in with the Anthropic CLI (`ant auth login`).

You can write prompts without a key by using **Blank template** or **Import prompt**. Only Enhance needs the API.

## What it does

- **Mode is derived, not picked.** Asset roles decide the guide variant:
  - no image → T2VA
  - first frame → I2VA
  - first + last frame → FL2VA
  - last frame only → L2VA
  - any reuse / transfer / edit / continuation / audio role → full-reference mode (`REFERENCE`)
- **Labels are automatic.** `<Picture N>`, `<Video N>`, `<Audio N>` follow list order, and `<Subject N>` follows the subject list. Reordering or removing an asset renumbers every reference in the text.
- **Every part is editable**, with a live checker for the guide's rules: `[Shot 1]` has no timestamp, later shots use `At MM:SS.mmm,`, speakers are numbered by first speech, dialogue sits in `<d>[Lang] …</d>`, retention markers come from the fixed vocabulary, the summary has its `[task type]` prefix, the description is 350–500 words, and so on.
- **Final text tab** shows the exact string sent to the model. **Import prompt** parses an existing guide-format prompt back into the editor.
- **9 presets** (sitcom, product reveal, music video, anime, horror, morph, ASMR, vlog, documentary).
- **Library** with live progress over SSE, a video player with Range support, a log and "Reuse prompt".

The guides live in `src/server/guides/` and are sent verbatim to Claude as the system prompt (cached).

## Connecting your local Minimax H3

I don't know how your H3 is launched, so generation goes through a small generic contract. **Settings → Video generation → Local model** takes a program, arguments, a working directory, a timeout and extra environment variables. For each job the app starts the program directly (no shell) in a fresh job folder under `data/jobs/<id>/`, with these environment variables:

| Variable | Meaning |
|---|---|
| `H3_JOB_DIR` | the job's working folder |
| `H3_JOB_JSON` | `job.json`: `{ id, mode, prompt, params, assets: [{ label, kind, role, path, filename, mime, note }] }` |
| `H3_PROMPT_FILE` | `prompt.txt`, the final structured prompt |
| `H3_OUTPUT` | where to write the video, `<job dir>/output.mp4` |

Rules:

- Reference files are copied into the job folder as `inputs/Picture_1.png`, `inputs/Video_1.mp4`, and so on, matching the labels in the prompt.
- Print `PROGRESS 40 sampling` or a JSON line `{"progress":0.4,"message":"sampling"}` to drive the progress bar (optional).
- **Success = exit code 0 and an `output.(mp4|webm|mov|m4v)` file in the job folder.** Anything else fails the job, and the last stderr lines are shown in its log.
- **Cancel** kills the whole process group.
- Jobs run one at a time.

A runnable stand-in is in `tests/fixtures/fake-h3.mjs`. A wrapper for a real model is usually about ten lines: read `H3_JOB_JSON`, call your inference script or local HTTP server, write the file to `H3_OUTPUT`. If you tell me how your H3 is invoked (CLI script or HTTP server), I can write that adapter.

The default backend is **Mock**. It simulates progress and renders a poster, so the whole UI can be tried with no model.

## Security

The server binds to `127.0.0.1` and is meant for one user on one machine.

- Host header allow-list (blocks DNS rebinding) and an Origin check on every non-GET request (blocks CSRF from other sites).
- `X-Content-Type-Options: nosniff` and `X-Frame-Options`; SVG uploads are rejected and any SVG served gets a sandbox CSP.
- Upload extension allow-list, strict ID validation, and path-traversal-safe file serving.
- The API key is stored `0600` and only a masked hint is returned to the browser.
- The command backend runs the program you configure, with your privileges. Treat Settings like a shell. Don't expose the port to a network.

Privacy notes:

- When you press Enhance, **reference images are sent to the Claude API** (downscaled JPEG previews made in your browser). For a video reference only one poster frame is sent, and for audio only the file name and your notes. The full files stay on your machine.
- The two H3 guides are vendored in this repo, which is public.

## Status

| Part | Verified how |
|---|---|
| Prompt engine (compile, lint, parse, relabel) | 27 unit tests, including round-trips of the guide's own examples |
| Server (security, assets, queue, command backend, Range) | 20 tests with the fake model |
| Web UI | Playwright run in real Chromium (`npm run e2e`): all flows, no console errors |
| **Live Claude call** | **Not yet tested against the real API.** The request shape (system blocks, `json_schema` output, effort, fallback beta, image blocks) was checked against a local stub only |
| **Real Minimax H3** | **Not connected**; it depends on how you run it (see above) |

Scripts: `npm test`, `npm run typecheck`, `npm run e2e` (needs `npm run build` first and a Chromium that Playwright can find).

## Refusal fallback

By default, if Claude declines a request, it is retried server-side on Anthropic's recommended fallback model (beta `server-side-fallback-2026-07-01`). Turn this off in Settings if you want refusals returned as errors.

## Configuration

| Env var | Default | |
|---|---|---|
| `PORT` | `8787` | |
| `HOST` | `127.0.0.1` | |
| `H3_DATA_DIR` | `data` | settings, assets, jobs |
| `H3_DEV_ORIGIN` | | extra allowed Origin (dev server) |
| `ANTHROPIC_API_KEY` | | used when no key is saved in Settings |
