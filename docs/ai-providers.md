# AI providers: text, images, stock photos, sites, video

Everything here was read from code. File names are under `server/`. Env variable names are listed, never values; real values live in `.env` (not documented here) and in the dashboard's AI providers dialog.

## 1. Text AI (`openrouter.mjs`)

Every text call (posts, site pages, video scripts, assistant, menu import, receipt scan, loyalty design, image description) goes through one function: `complete(opts)`. Callers pass `{ key, prompt, system, tier, json, images, onDelta, signal, maxTokens, timeoutMs, attempts, validate }` and get `{ text, model }` (plus `json` when asked). `tier` is `quick`, `default` or `complex`.

### Provider chain

- Providers: `groq`, `google` (Gemini via its OpenAI-compatible endpoint), `mistral`, `siliconflow`, `deepseek`, `alibaba` (DashScope/Qwen), `tokenharbor`, `puter`, `openai`, `openrouter`. All except `puter` and `openrouter` share one OpenAI-compatible client (`viaCompat`, table `COMPAT`).
- Default order (`DEFAULT_ORDER`): `groq,google,mistral,siliconflow,deepseek,alibaba,puter,tokenharbor,openai,openrouter`.
- Order override: dashboard setting `order` (comma list) beats env `AI_PROVIDERS`. The chosen names go first; every other known provider is appended in default order, so a new provider is never silently left out.
- A provider is only tried if it has a key. `complete()` walks the list; on any error from one provider (rate limit, bad key, timeout, empty or invalid reply) it logs a warning and moves to the next. If all fail, the error lists what each one said (`All AI providers failed. groq: ... | ...`). Only an abort (`signal`) stops the walk early.
- **Paid providers are never used by Auto.** `openai` is marked `paid: true` and is filtered out of the automatic chain; it runs only when the owner pins it (dashboard `x-ai-provider` header for that request, or `client.aiProvider` for one business).
- Pinning: `runWithProvider(name, fn)` (admin header, set in `index.mjs`) and `withClientAi(fn)` (wraps site builder, stock, video script; uses `client.aiProvider` unless the owner already pinned one) use an `AsyncLocalStorage`, so background work started inside keeps the pin. A pinned provider without a key throws a clear error instead of falling back.
- `aiKey()` is the "is AI set up?" check used by callers: the OpenRouter key, or the placeholder `"-"` when only other providers are configured. `complete()` skips OpenRouter when the key is `"-"`.

### Per-provider env keys and defaults

| Provider id | Env key | Optional env | Notes |
|---|---|---|---|
| groq | `GROQ_API_KEY` | `GROQ_MODELS`, `GROQ_BASE_URL` | per-model free tokens-per-minute table (`tpm`); a request too big for a model is skipped, not sent |
| google | `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | `GEMINI_MODELS`, `GEMINI_BASE_URL` | uses `-latest` model aliases |
| mistral | `MISTRAL_API_KEY` | `MISTRAL_MODELS`, `MISTRAL_BASE_URL` | |
| siliconflow | `SILICONFLOW_API_KEY` | `SILICONFLOW_MODELS`, `SILICONFLOW_BASE_URL` | |
| deepseek | `DEEPSEEK_API_KEY` | `DEEPSEEK_MODELS`, `DEEPSEEK_BASE_URL` | output capped per model (`maxOut`) |
| alibaba | `DASHSCOPE_API_KEY` | `ALIBABA_MODELS`, `ALIBABA_BASE_URL` | |
| tokenharbor | `TOKENHARBOR_API_KEY` | `TOKENHARBOR_MODELS`, `TOKENHARBOR_BASE_URL` | OpenAI-compatible gateway; default model `deepseek-v4.1-flash:free`; text only (`vision: []`) |
| puter | `PUTER_AUTH_TOKEN` | `PUTER_MODELS` | see section 1.4 |
| openai (paid) | `OPENAI_API_KEY` | `OPENAI_MODELS`, `OPENAI_BASE_URL` | never in Auto |
| openrouter | `OPENROUTER_API_KEY` | `OPENROUTER_BASE_URL`, `OPENROUTER_TIMEOUT_MS` | free models only, see 1.2 |

Model lists per tier are in `COMPAT[...].models`. A model list can be overridden per provider in the dashboard (`settings.ai.models.<id>`) or with the `*_MODELS` env var. Image inputs use the provider's `vision` models only; a provider with none (`deepseek`) fails immediately for vision requests and the chain continues. Puter handles images through `puter.ai.chat` with its own model choice.

### Keys saved in the dashboard win over `.env`

`compatKey(name) = saved(name) || envKey(name)`, and `openrouterKey() = saved || env`. Saved keys live in `db.settings.ai` (`groqKey`, `geminiKey`, `mistralKey`, `siliconflowKey`, `deepseekKey`, `alibabaKey`, `puterKey`, `tokenharborKey`, `openaiKey`, `openrouterKey`). `configureAi(() => db.settings.ai)` in `index.mjs` wires this, and keys are re-read on every call, so saving a key takes effect without a restart. `keySources()` tells the dashboard whether each key comes from `saved`, `env` or nothing. API responses only return a masked key (`••••` plus the last 4 characters); posting a value that starts with `••••` leaves the stored key unchanged.

### 1.2 OpenRouter: free models only

- `isFree(m)`: id ends in `:free`, or both `pricing.prompt` and `pricing.completion` are 0 (and the id is not `openrouter/auto*`). `rankModels` filters to these, text-only output, and excludes non-chat models (music, speech, embeddings, guards, code-only, routers). For image input it also requires `image` in input modalities.
- Ranking: regex preference lists per tier (`PREFER`), then by context length. The live model list is fetched from `/models` and cached 30 minutes (`LIST_TTL`).
- Attempts: up to `attempts` (default 4) rounds; each round sends the next 3 ranked models as OpenRouter's own `models` fallback array. Per-attempt timeout is `OPENROUTER_TIMEOUT_MS` (default 120 s) or the caller's `timeoutMs`. A 400 about `max_tokens` is retried once without it.
- **401 or 402 is fatal** for this provider ("refused the key"); the chain then moves on to the next provider.
- If no free model is available the call throws "No free models are available on OpenRouter right now".

### 1.3 Cooldown and fallback

A shared in-memory `cooling` map holds `until` timestamps:
- OpenRouter model failing (HTTP error, timeout, empty reply, non-JSON when JSON was asked): cooled 10 min (`COOLDOWN`) and skipped by `rankModels`.
- OpenAI-compatible providers, key `provider:model`: 429 cools 60 s, 413 cools 5 min, anything else 10 min. 401 is fatal for that provider. 403 and other statuses only fail that model, so the next model of the same provider is tried before leaving it.
- A reply rejected by the caller's `validate()` (for example a truncated web page) skips that model for the rest of the call but does not cool it.
- JSON mode: `extractJson` strips `<think>` blocks and fences and keeps the longest parsable object/array; unparsable replies count as a failure of that model.
- `resetCooling()` and `status()` exist for tests and the dashboard.

### 1.4 Puter (`puter.mjs`, `openrouter.mjs`)

- `puterApi()` lazily creates a Puter.js client from the saved token (dashboard `puterKey`, set with "Sign in with Puter" via `/puter-callback` + `POST /api/studio/settings/ai/puter-token`, or `PUTER_AUTH_TOKEN`).
- As a text provider (`viaPuter`): non-streaming `puter.ai.chat`, models from the Model box or `PUTER_MODELS`, else Puter's default; same cooldown logic.
- `puter.mjs` adds what Puter can do beyond chat: `puterImage` (txt2img, optional reference photo, model from dashboard `puter.imageModel`), `puterSpeech` (txt2speech, provider/voice from dashboard `puter.voiceProvider`/`voice`, default provider `openai`), `puterTranscribe` (speech2txt, used by `assistant.mjs` for voice notes). `toBuffer` normalizes whatever Puter returns (bytes, Blob, data URL, http URL) into a Buffer.
- Puter is in the Auto text chain (it has no `paid` flag) but is the only one whose usage depends on the owner's Puter allowance, not a provider free tier. Puter images are used only if the owner chooses the `puter` image engine (section 2).

## 2. Images (`images.mjs`)

`generateImage(prompt, file, { size, reference, fetchImpl, attempts, forceFree })` is the single entry point (posts, video scenes, site fallback pictures; loyalty card art calls it with `forceFree: true`). It returns `{ engine, note? }`.

- Engines (`PROVIDERS`): `free` (default), `openrouter`, `google`, `puter`. Chosen by dashboard `settings.images.provider`, else env `IMAGE_PROVIDER`, else `free`.
- **Paid engines are never used by Auto.** Nothing switches to `google`, `openrouter` or `puter` on its own; the owner must pick one. A chosen engine without its key quietly resolves to `free` (`imageEngine().provider`).
- Keys: Google key = dashboard `googleKey`, else `GOOGLE_API_KEY`/`GEMINI_API_KEY`. The OpenRouter image engine uses env `OPENROUTER_API_KEY` only (not the dashboard-saved text key). Models: dashboard choices, else `GOOGLE_IMAGE_MODEL` / `OPENROUTER_IMAGE_MODEL`, else the first entry of `GOOGLE_MODELS` / `OPENROUTER_IMAGE_MODELS`. Google can pass the client's photo as a reference; so can OpenRouter and Puter.
- Fallback: if a paid engine fails and `settings.images.fallback !== false` (default on), the picture is made with the free engine and `note` explains why (`Paid image engine failed, falling back`). With fallback off the error is thrown. `forceFree: true` skips paid engines entirely.
- **Pollinations (free, no key)**: `pollinationsImage` retries up to 3 times with a new seed; `inLine()` is one global queue and, when no `POLLINATIONS_KEY` and no custom `POLLINATIONS_BASE_URL` is set, enforces a 46 s gap (`POLLINATIONS_GAP_MS`) between starts because the free tier allows one image per 45 s per IP. Posts, video scenes and site images all wait in the same line. HTTP 402/429 waits the `Retry-After` (default 45 s) up to 6 times. The model is picked from the service's live `/models` list (cached 1 h; `IMAGE_MODEL` is honored when listed). It asks for a 7.5 % taller image, crops the watermark strip off the bottom and scales to the exact size with `@napi-rs/canvas` (`finishImage`; without canvas the raw image is returned).
- Upload hardening in the same file: `sniffMedia` (magic bytes), `assertSafeImage`/`guardImage` (type and 50 megapixel cap), used before any decode.
- If the free engine also fails, `generateImage` throws; callers decide (posts retry, section 5).

## 3. Stock photos (`stock.mjs`)

Used by the site builder for product and hero images.

1. `stockQueries`: asks the text AI (tier `default`, 2 attempts, 60 s) for short English stock search terms, a general list (hero first) and one query per service. With no AI key or on error it falls back to `client.kind`/`client.offer` and the service names.
2. `searchStock`: **Pexels** if a key is set (dashboard `pexelsKey` beats `PEXELS_API_KEY`); if Pexels returns nothing or fails, **Openverse** (no key, CC0 photographs only, so no credit line is needed), scored toward known stock libraries and query-word matches, wide aspect for the hero. Base URLs can be overridden with `PEXELS_URL` / `OPENVERSE_URL` (used by tests).
3. Filters: no people, paintings or illustrations (title and tag regexes); `downloadPhoto` allows only public hosts through `guardedFetch` (`reference.mjs`, SSRF protected, redirects re-checked), max 15 MB, JPEG/PNG/WebP by magic bytes, and rejects near-greyscale photos.
4. `findStockPhotos` returns one photo per service, then general ones (three search rounds). Failures are logged and skipped. It runs under the client's pinned AI provider (`withClientAi`).

## 4. Site builder prompting (`aisite.mjs`, `directions.mjs`, `sitebuilder.mjs`)

Pipeline in `sitebuilder.buildSite` (only for businesses on the "build with AI" website mode; `ownsite.mjs` clients are skipped):

1. `prepareAssets` (`aisite.mjs`): logo (palette extraction), up to 8 client photos (described by a vision model when a key exists), then stock photos, and only if fewer than 3 pictures exist, up to 3 generated pictures via `generateImage` (still-life/object prompts, no people). `siteimages.mjs` plans which image fills which slot.
2. `pickDirection` (`directions.mjs`): 8 art directions (`editorial`, `swiss`, `photographic`, `colourblock`, `artisanal`, `darkluxe`, `bento`, `fresh`), each with `fits` styles and an optional `minImages`. A rebuild keeps the current direction; "New AI design" (`newDesign`) picks a different one that fits the business's style and photo count. `directionPrompt` appends its spec to the main prompt.
3. `designPrompt`: one large prompt with the business facts (name, kind, town, address, hours, services and prices, story, social links, languages), colours (chosen, else from the logo, else per-style defaults), the exact image paths and slots available, booking/menu button spacing rules, the art direction, optional `referenceBlock` (example sites the owner listed, fetched with the SSRF guard), and hard rules (single HTML document, no inline JS, limited external CSS/fonts, SEO and accessibility). System text is `CONTEXT` from `studio.mjs`.
4. `buildAiSite`: main page with tier `complex`, `maxTokens` 16000, timeout `SITE_MODEL_TIMEOUT_MS` (default 9 min), 3 attempts, streaming, and `validate: pageProblem` so a cut-off or broken page makes the next model try. Output goes through `extractHtml` -> `sanitize` -> `fixPageImages` (`webpage.mjs`, `siteimages.mjs`).
5. `qualityCheck`: a JSON review (tier `default`, score 0-10, plus mechanical `lintPage` findings). Below 8, one improvement pass (tier `complex`) and a second review; the better version is kept. Never fails the build.
6. Other languages: one translation call per extra language (tier `default`); a failed translation is skipped and the build still succeeds with the languages that worked.
7. Files are written to a temp folder next to the live site and swapped in with renames, so the old site stays up during a rebuild.

## 5. Failure behavior and fallbacks

There is deliberately **no template fallback for posts or websites**:

- **Websites** (`sitebuilder.mjs`): if the AI is unavailable or errors (`e.ai`/`e.fatal`), status becomes `waiting` with `nextTryAt` and backoff `[2, 5, 10, 30, 60]` minutes; `startSiteRetries` checks every minute and retries forever, capped at hourly, keeping any live site. Non-AI errors become `failed` (retried by hand). Builds stuck in `building` for over 15 minutes are resumed.
- **Posts** (`studio.mjs`): "never falls back to a template". No AI: status `waiting`. AI or image error: `failed` with `retryable`, backoff `[1, 2, 5, 10, 30, 60]` minutes, up to 6 attempts; `retryDue` restarts them from the scheduler. A retry after an image error keeps the AI-written captions and redoes only the image.
- **Video script** (`video.mjs` `writeScript`): the one real template fallback. With **no AI key at all** it builds a simple script from the brief text (model label "template (...)"). With a key but a failing AI, the video fails and can be retried.
- **Images**: paid engine to free engine fallback (section 2). In the site builder a failed picture is logged and skipped. Missing `@napi-rs/canvas` returns un-cropped images.
- **Other softened failures**: `describeImage` returns `""`; `stockQueries` uses plain queries; loyalty card design uses the default look (`loyalty-design.mjs`); Puter voice failure falls back to the system voice; voice-note transcription failure only logs. Menu import/translate and receipt scan return a user-readable error and let the user enter data by hand.

## 6. Video (`video.mjs`)

- Needs `ffmpeg` (path from `FFMPEG_PATH`, else `ffmpeg` on `PATH`) and `@napi-rs/canvas`. `capabilities()` checks once; `addVideo` in `index.mjs` returns 503 if ffmpeg is missing, and `runVideo` fails with an install hint.
- Flow in `runVideo`: script (`writeScript`, tier `default`, JSON, per language) -> one image per scene via `generateImage` (9:16, reference photo if the client attached one, so the same engine and Pollinations queue rules apply) -> text overlays drawn with canvas -> ffmpeg Ken-Burns zoom/crossfades plus end card -> one MP4 per language plus a cover frame. Lengths: 15, 20 or 30 s (`LENGTHS`).
- Voice-over: Puter text-to-speech if a Puter token is saved, otherwise macOS `say` voices (`capabilities().voices`), otherwise silent. Audio files are probed with `ffprobe` (same folder as ffmpeg).
- All renders share one queue (`enqueueRender`), so only one ffmpeg job runs at a time. `startVideoScheduler` resumes videos left in `generating`; `videoTick` (every 60 s) creates autopilot videos when the business is approved and under its weekly cap.
- ffmpeg arguments are hardened (`hardenInputs`, protocol whitelist) before use.

## 7. Voice (`voice.mjs`)

Speaking and listening, for the business dictating the items of an expense. Nothing here is required:
without a key the browser can still do the listening itself (`SpeechRecognition`), and Puter can be used
for the voice.

- **Speech to text:** NagaAI first (`POST /v1/audio/transcriptions`, multipart, model `gpt-4o-transcribe`), then Puter (`puterTranscribe`, on the owner's own allowance). The recording only travels to those two.
- **Text to speech:** NagaAI first (`POST /v1/audio/speech`, model `gpt-4o-mini-tts`), then Puter (`puterSpeech`).
- **Keys:** `NAGAAI_API_KEY` (optional), `NAGAAI_BASE_URL` (default `https://api.naga.ac/v1`), `NAGAAI_TRANSCRIBE_MODEL`, `NAGAAI_TTS_MODEL`, `NAGAAI_TTS_VOICE`.
- **What is said is never a fact:** the transcript is read by the model into items, and every amount is computed by the server from the stored expenses. A failed transcription returns no items and says so.

## 8. How tests fake providers

- **Unit level**: `complete()` and image functions take an injectable `fetchImpl`. `openrouter.test.mjs` uses a `mockFetch` that serves a canned `/models` list and queued chat responses (429, 401, SSE streams, JSON replies) and calls `resetCooling()` between cases; `runWithProvider` is used to test pinning and "no API key" errors. `images.test.mjs` passes `fetchImpl` to simulate Pollinations, Google and OpenRouter image APIs, `forceFree`, and fallback. `puter.test.mjs` tests `toBuffer` only (no real Puter calls). Stock and reference code take `fetchImpl`/`lookupImpl` too.
- **End-to-end**: `e2e.test.mjs` starts a local mock HTTP server and spawns the real `index.mjs` with a clean environment (`test-harness.mjs` -> `blankedEnv()` sets every provider key variable to an empty string, because `loadEnv` never overrides variables that are already set, so a developer's `.env` cannot leak in). The test then sets `OPENROUTER_API_KEY` to a dummy, `OPENROUTER_BASE_URL`, `POLLINATIONS_BASE_URL`, `OPENVERSE_URL`, `AI_PROVIDERS=openrouter`, plus social API URLs, all pointing at the mock, with temp `DATA_DIR` and `SITES_DIR`. Setting a custom `POLLINATIONS_BASE_URL` also removes the 46 s image gap, which keeps tests fast.
- Rule for new tests: never call a real provider; inject `fetchImpl` for in-process tests or add a path to the mock server for spawned ones, and blank all provider env vars.

## 9. Open points

- `openrouter.mjs`'s top comment still says "Groq, Mistral and OpenRouter"; the real chain has more providers (see `DEFAULT_ORDER`). The startup log in `index.mjs` and the 503 error text of `/api/ai` also name only Groq/Mistral/OpenRouter keys.
- The OpenRouter **image** engine reads only the env key, not a key saved in the dashboard, unlike text.
