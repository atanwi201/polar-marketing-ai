# Isla Autopilot

Back office for the one-person AI marketing studio in Tenerife: all 10 business plans as working screens.

- **Run the business:** Today dashboard, clients and pipeline (with LSSI consent records), door-to-door visit log and pitch writer, billing with 7% IGIC and quarterly modelo 420 totals, client reports, settings.
- **Services:** Maps & Reviews (P1), AI Visibility (P8), WhatsApp Receptionist (P6), Listing Kits (P4), Retention Flows (P10), Video Ads (P2), Activity Pages (P3), Clip Engine (P7), Agency Social (P5), Makers Online (P9).

## Autonomous studio (local server)

`server/` is a small Node server (no dependencies) that makes the business run on its own:

1. **Client sign-up** at `/signup`: the client enters their business and what they offer (photo optional).
2. **Website**: the AI writes an SEO site in every customer language and builds it in `sites/<client-name>/` (hreflang, canonical, Open Graph, LocalBusiness + FAQ JSON-LD, sitemap.xml, robots.txt, AI images). It's plain HTML, served at `/sites/<client-name>/` and deployable anywhere.
3. **Client portal** at `/portal/<token>`: the client says what to market, with or without an image. The AI writes captions in each language and generates a **new image every time**. An uploaded photo is described by a free vision model and used as reference, never reused.
4. **Autopilot**: each client gets N posts a week (default 3) from their briefs in rotation, each with a fresh image. Set a webhook (n8n, Make, Zapier) per client to auto-publish to Instagram/Facebook.
5. **Owner view**: the app's Content Studio screen.

AI text: OpenRouter **free models only**. The free list is fetched live, ranked by quality per task, with automatic fallback and cooldown when a model is rate-limited (`server/openrouter.mjs`). Images: Pollinations (free, no key). Without an OpenRouter key, captions fall back to a simple template; images still work.

```
cp .env.example .env    # add OPENROUTER_API_KEY
npm install
npm run dev             # app on :5173, API + sign-up + portal + sites on :8787
npm test                # unit + end-to-end tests (fake OpenRouter/Pollinations)
npm start               # production: build, then serve everything on :8787
```

Data lives in `data/` (git-ignored). Generated sites live in `sites/`.

## How it runs

- React 18 + TypeScript + Vite, built to one HTML file (`npm run build` → `dist/artifact.html`, published as a claude.ai artifact).
- **AI:** `src/core/ai.ts`. On claude.ai the page asks Claude (artifact `sample` capability). Locally it uses OpenRouter free models through `server/`. With neither, every feature falls back to realistic demo output.
- **Data:** `src/core/store.ts`. The artifact's shared db on claude.ai, localStorage elsewhere. Settings has load/remove example data, backup and restore.
- **Integrations** (Google Business Profile, WhatsApp Cloud API, Meta, DataForSEO, ElevenLabs, Creatomate, Shopify/Etsy, Brevo, Stripe…) are not connected. Their actions are clearly marked as simulated. The next step for production is a small Node/n8n backend that holds the keys and replaces each simulated action.

## Layout

- `src/core/` shared kit: UI components, store, AI, plan catalogue and prices, business maths, example data.
- `src/screens/` business screens. `src/modules/<route>*.tsx` one module per plan, each exporting `Screen` and `seed()`.

## Develop

See "Autonomous studio" above. `npm run dev:web` runs only the front end (demo mode).
