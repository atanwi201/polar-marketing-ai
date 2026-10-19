# Sub-processors / Subencargados (Polar Marketing)

Status: draft pre-filled from the code. Items marked **[PENDING ATD]** need the controller's input. Keep in sync with `server/legal.mjs` (privacy page).

| Provider | Purpose | Data involved | Country | Transfer safeguard |
|---|---|---|---|---|
| Resend | Transactional booking email | Booker name, email, booking details | US | DPF / SCC **[PENDING ATD: verify certification, sign DPA]** |
| Hosting VPS **[PENDING ATD: provider]** | Server, data store, backups | All data | **[PENDING]** | **[PENDING]** |
| OpenRouter | AI text (routes to third-party models) | Business profile, prompts | US | SCC/DPF **[PENDING ATD]** |
| Google Gemini | AI text/image, receipt vision | Business content, receipt photos | US/EU | DPF/SCC; check paid vs free terms (training) **[PENDING ATD]** |
| Groq | AI text/vision | Business content, receipt photos | US | SCC **[PENDING ATD]** |
| Mistral | AI text/vision | Business content, receipt photos | EU | EEA |
| SiliconFlow | AI text/image | Non-personal content only | China/other | No adequacy; SCC + transfer assessment **[PENDING ATD]**; do not send personal data |
| Puter | AI text/image | Business content | US | SCC **[PENDING ATD]** |
| Pollinations | Image generation | Image prompt in URL (public feed risk) | **[PENDING]** | Non-personal prompts only |
| Meta, X, YouTube/Google | Publishing to the business's own accounts | Posts, media | US | DPF/SCC |
| Google Wallet, Apple Wallet | Loyalty card on phone (user-initiated) | Member name, card code | US | User-initiated |
| jsDelivr (generated client sites) | Bootstrap/animate.css CDN | Visitor IP | US/CDN | List until self-hosted |

Change process: add provider here and in the privacy page, notify businesses (controllers) in advance per the DPA (default 15 days), allow objection.
