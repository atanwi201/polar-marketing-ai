# Isla Autopilot

Back office for the one-person AI marketing studio in Tenerife.

- **Today:** what you earn per month and progress to your goal, one to-do list in plain words (posts to check, trials ending, invoices to create or chase, follow-ups) and quick actions.
- **Two paid plans** (default Básico €49 and Pro €99 a month, plus a free trial): names, prices, setup fee, what's included and posts/videos a week are all editable in *Plans & prices*. Any client can have their own price. Billing, the dashboard and the studio's autopilot all follow the plan.
- **Businesses:** every business as a card (status, plan, website, posts, and a red "needs you" when the assistant flagged something). Click one for its own page: Overview, Conversation (read what they asked the assistant and reply as "your team"), Posts, Videos, Website, Plan & billing, Social accounts and Details. Leads can be started on the autopilot from there. Sign-ups from the sign-up page appear on their own, on a free trial.
- **The business's dashboard** (`/portal/<link>`) is a chat with an **AI assistant**. They write what they want and can attach a photo or a video; the assistant decides what to do and does it (`server/assistant.mjs`): their photo with the offer written on top (Instagram 4:5), their video as a vertical Reel/Short with the offer on top (sound kept), a new AI image with the offer on it, a video ad, new opening hours/phone/products (website rebuilt), or an answer. What only a person can handle is flagged for you on Today and in Businesses.
- **All posts & videos** (the content studio across businesses), **Billing** with 7% IGIC and quarterly modelo 420 totals, visits and follow-ups, client reports, settings.
- **Extra tools:** the ten older one-service screens (Maps & Reviews, AI Visibility, WhatsApp Receptionist, Listing Kits, Retention Flows, Video Ads, Activity Pages, Clip Engine, Agency Social, Makers Online) are hidden from the menu; switch them on in Settings.

## Autonomous studio (local server)

`server/` is a small Node server (one dependency, `@napi-rs/canvas`, to draw the video text; ffmpeg for video) that makes the business run on its own:

1. **Client sign-up** at `/signup`: a 5-step wizard (business, brand with logo, slogan, style and colours, what they offer with products and prices, where and when with address, hours, links and social profiles, and up to 8 photos). Everything but the basics can be skipped and added later from their dashboard ("Complete your website", with a checklist), by sending their logo in the chat, or by you in the business's Website tab.
2. **Website**: a premium page designed from scratch by a free model from **one big prompt** (`server/aisite.mjs`) with everything the business told us: logo (its colours become the palette), slogan, style, products with prices, story, address, hours, links, social profiles and their real photos. Free stock photos fill the gaps (`server/stock.mjs`: public-domain photos from Openverse with no key, or Pexels with a free `PEXELS_API_KEY`); AI pictures are only a last resort. The server then makes it safe and complete (`server/webpage.mjs`: no scripts, only their images, only a Google Maps iframe, strict CSP) and adds the SEO head (canonical, hreflang, Open Graph, LocalBusiness + FAQ JSON-LD), sitemap.xml and robots.txt. Other languages are translations of the same design. Rebuilds keep the design unless you ask for a new one; if the model fails, a clean template is used. Built in `sites/<client-name>/` (the live site stays up while a new one is made), served at `/sites/<client-name>/`, deployable anywhere. Takes about 5 to 10 minutes on free models.
3. **Client portal** at `/portal/<token>`: the client says what to market, with or without an image. The AI writes captions in each language and generates a **new image every time**. An uploaded photo is described by a free vision model and used as reference, never reused.
4. **Posts**: for every post the AI writes the captions (one per language), a short version for X, hashtags, a call to action and an image description (alt text), and draws a brand-new image. From the studio you can edit the text, draw a new image or make another version.
5. **Video ads**: 15, 20 or 30-second vertical videos (1080×1920 H.264/AAC MP4) for Instagram Reels, Facebook Reels and YouTube Shorts. The AI writes the script, every scene gets a new image, the text is drawn on screen inside the platforms' safe zones, ffmpeg animates it (slow zoom, crossfades, end card with the call to action and contact) and adds an "made with AI" label. One MP4 per language from the same images, optional voice-over with the macOS system voices. Edit the on-screen text and render again without redrawing.
6. **Sharing and publishing**: every post and video has a **Share** button.
   - *Post directly* to the client's connected accounts: Facebook Page (photo or Reel), Instagram (photo or Reel), X (photo post) and YouTube Shorts (`server/social.mjs`). Connect them per client under *Social accounts*; tokens stay on the server and the studio only shows the last 4 characters. *Check connections* tests them.
   - *Share by hand*: the device share sheet (phones send the image or video straight to Instagram, Facebook, X, WhatsApp), or one click per app that copies the caption, downloads the file and opens Instagram, Facebook, X or YouTube Studio. With `PUBLIC_URL` set, Facebook and X get a link preview from the post's public page `/p/<key>`.
   - The client portal has the same share buttons, and clients can ask for a short video with their post.
7. **Autopilot**: each client gets N posts a week (default 3) and optionally N videos a week, from their briefs in rotation. With auto-publish on, they go to every connected account in the client's platforms, plus the client's webhook (n8n, Make, Zapier) if set.
8. **Owner view**: the app's Content Studio screen (Clients, Feed, Videos, Briefs).

Instagram posting needs a business or creator account linked to a Facebook Page, and Instagram photos are fetched by Meta from `PUBLIC_URL` (videos are uploaded directly). Unverified Google apps can only upload private YouTube videos until Google reviews them.

Keys live in `.env` (see `.env.example`); `npm run push-env` copies just the AI keys to the server and restarts it, so you set them once. AI text: **Groq, Google, Mistral, SiliconFlow, DeepSeek, Alibaba, Puter, OpenAI and OpenRouter** in turn (`GROQ_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`; any one is enough, order via `AI_PROVIDERS`), so a rate limit on one moves on to the next. OpenRouter uses **free models only**. The free list is fetched live, ranked by quality per task, with automatic fallback and cooldown when a model is rate-limited (`server/openrouter.mjs`). Images: **free by default** (Pollinations, no key; it uses whichever model the free service offers). In the studio, *Images* switches to **OpenRouter** (paid image models with the same `OPENROUTER_API_KEY`, about 1.5 cents an image with FLUX.2 Klein) or **Google** (your own key). Paid engines get the client's photo as a reference, and fall back to the free service if they fail. The free tier allows one image every 45 seconds per IP and stamps a small logo, so its requests wait in one line and the logo strip is cropped off (`server/images.mjs`); a `POLLINATIONS_KEY` removes the wait. Without an OpenRouter key, captions fall back to a simple template; images still work.

```
cp .env.example .env    # add OPENROUTER_API_KEY (and X / YouTube app keys to publish there)
brew install ffmpeg     # for video ads (Linux: apt install ffmpeg)
npm install
npm run dev             # open http://localhost:5173: landing page at /, your dashboard at /admin/ (API on :8787)
npm test                # unit + end-to-end tests (fake OpenRouter/Pollinations)
npm start               # production: build, then serve everything on :8787
```

Data lives in `data/` (git-ignored). Generated sites live in `sites/`.

**Signing in** (`server/landing.html`, `server/auth.mjs`): the home page has two doors. *Admin*: the first visit creates your password (or set `ADMIN_PASSWORD` in `.env`); it's stored as a scrypt hash and keeps you signed in for 30 days with an HttpOnly cookie. Your dashboard (`/admin/`), its API and the AI proxy need it; change it in Settings. *Client*: each business has a 6-character code like `K7P-M3Q` (shown in Business › Overview and in their dashboard); typing it opens their dashboard. Wrong passwords and codes are limited per IP. "New dashboard link and code" replaces both.

**Website designs**: each site gets an art direction modelled on the styles curated on [SiteInspire](https://www.siteinspire.com/) (editorial, Swiss grid, photo-led, bold colour blocks, warm artisanal, dark luxe, bento grid, fresh and organic; `server/directions.mjs`), picked to suit the style the business chose. Rebuilds keep it; "New AI design" picks another.

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
