# Studio H3

A local, Higgsfield-style prompt studio for **Minimax H3**. You describe a scene in plain words, attach reference images, video or audio, and the app produces the **official structured H3 prompt** (the format in the vendored writing guides). It then queues generation on your local model.

```
rough idea + assets ──► Claude (fills a JSON schema) ──► deterministic compiler ──► exact H3 prompt ──► your local H3
```

The point is that the output **format cannot drift**. Claude only fills a structured form (shots, timecodes, dialogue, soundscape, music, subject definitions, retention markers). A deterministic compiler assembles the final text, and a linter checks it against the guide's rules.

## Quick start

Requires [Node.js](https://nodejs.org) 20 or newer.

1. Download the repository ZIP and unzip it.
2. Double-click **`start.bat`** (Windows) or run **`./start.sh`** (macOS / Linux). The first run installs dependencies and builds the UI, then opens http://127.0.0.1:8787.
   Or by hand: `npm install && npm run build && npm start`.
3. Open **Settings → Video generation → MiniMax H3**, point it at your model folder and press **Scan folder** (next section).

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

## Using your downloaded MiniMax H3 folder

H3 is released by MiniMax as two checkpoints in one Hugging Face repository (`MiniMaxAI/MiniMax-H3`), and the official way to run them locally is an **SGLang** server. Studio drives that server for you:

```
MiniMax-H3/
├── model_index.json
├── FL2VA/   text-to-video, first-frame, last-frame, first+last-frame   (T2VA / I2VA / L2VA / FL2VA prompts)
│   └── model_index.json  processor/  tokenizer/  text_encoder/  transformer/  visual_vae/  audio_vae/
└── Ref2VA/  image / video / audio references                           (full-reference prompts)
    └── …same layout…
```

**Settings → Video generation → MiniMax H3 → Model folder:** paste the path (or press **Browse…**) and press **Scan folder**. You can give the exact folder, the `FL2VA` / `Ref2VA` folder, or any folder above it. The scan:

- finds the model root, and checks that every component exists and has real weights. It tells you about missing components, missing weight shards, Git-LFS pointer stubs (a clone made without LFS), and interrupted `hf download` runs;
- finds **SGLang** in a virtual environment next to the models (`.venv`, `venv`, `env` in the folder or up to two levels above), in the active Python environment, or on `PATH`;
- reads your GPUs from `nvidia-smi` and fills in the settings it found.

Then just press **Generate**. For each job Studio:

1. picks the checkpoint the prompt needs (T2VA / I2VA / L2VA / FL2VA → `FL2VA`, any reuse of subjects, source video or audio → `Ref2VA`);
2. starts `sglang serve --model-path <folder> --model-variant fl2va|ref2va --num-gpus N --host 127.0.0.1 --port P` if it isn't running (first load takes minutes; Ref2VA uses port P+1). A server holds one checkpoint, so switching checkpoints restarts it;
3. sends MiniMax's documented request, `POST /v1/videos` with `{ task, prompt, conditions, target: { short_edge: 768, aspect_ratio, duration_seconds }, seed }`, passing your reference files as `file://` URIs, then polls `GET /v1/videos/{id}` and downloads `/content` as `output.mp4`;
4. stops the server after 20 idle minutes (configurable) to free the GPU, and on quit.

What the model itself allows is enforced before queueing: 4–15 s, Ref2VA ≤ 9 images, ≤ 3 videos, ≤ 3 audio clips, ≤ 12 files in total, audio only together with an image or video. Output is 768p on the short edge (2K needs MiniMax's cloud H3-Regenerate-2K, which is not part of the open weights).

**Not what you have?** The scan says so instead of failing later:

- *SGLang not found* — install SGLang with MiniMax-H3 support (see the [SGLang cookbook](https://docs.sglang.io/cookbook/diffusion/MiniMax/MiniMax-H3)) into a `.venv` next to the models, or set its path under *Advanced*. Studio does not install the inference engine itself.
- *Windows* — SGLang runs on Linux. Run it in WSL or Docker yourself and choose **I run the server myself**: give the two URLs and set the file transport to **Embedded** so the server doesn't need to see your Windows paths.
- *ComfyUI install, or a diffusers / vLLM-Omni setup* — detected and reported, but Studio does not drive those yet.

### Any other program (custom command)

**Backend → Custom command** runs your own program once per job (no shell), in a fresh folder `data/jobs/<id>/`, with these environment variables:

| Variable | Meaning |
|---|---|
| `H3_JOB_DIR` | the job's working folder |
| `H3_JOB_JSON` | `job.json`: `{ id, mode, prompt, params, assets: [{ label, kind, role, path, filename, mime, note }] }` |
| `H3_PROMPT_FILE` | `prompt.txt`, the final structured prompt |
| `H3_OUTPUT` | where to write the video, `<job dir>/output.mp4` |

Reference files are copied to `inputs/Picture_1.png`, `inputs/Video_1.mp4`, … matching the prompt labels. Print `PROGRESS 40 sampling` (or `{"progress":0.4,"message":"sampling"}`) to drive the progress bar. Exit code 0 plus an `output.(mp4|webm|mov|m4v)` = success; cancel kills the whole process group. A stand-in is in `tests/fixtures/fake-h3.mjs`.

The **Mock** backend simulates progress and renders a poster, so the whole UI can be tried with no model.

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
| Prompt engine (compile, lint, parse, relabel) | unit tests, including round-trips of the guide's own examples |
| Server (security, assets, queue, command backend, Range) | tests with a fake model program |
| H3 folder scan, request builder, server manager, backend | tests with fake model folders (complete / missing parts / LFS stubs / lower-case names / ComfyUI) and a **fake `sglang` executable** that implements `/health` and `/v1/videos`; 73 tests in total |
| Web UI | Playwright run in real Chromium (`npm run e2e`): every prompt mode, folder scan and picker, starting and stopping the server, generating through it, cancel, import, no console errors |
| **Live Claude call** | **Not yet tested against the real API.** The request shape was checked against a local stub only |
| **Real MiniMax H3 / real SGLang** | **Not run** (no GPU or weights here). Flags and request fields follow [MiniMax's README and reproducible scripts](https://github.com/MiniMax-AI/MiniMax-H3). Three details are inferred, not documented, and are the first places to look if something fails: the last-frame condition uses `frame_index: -1`, `/health` is used for readiness (a 404 is tolerated), and the progress field of the status response is read if present |

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
