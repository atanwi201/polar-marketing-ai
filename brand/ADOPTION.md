# Adopting Polar Marketing in the webapp

Load `tokens.css` and `components/bundle.css` before the page styles. Wrap pages in `class="cr-root"`; set `data-theme="dark"` for dark.

Map the existing variables in `server/signup.html` and `server/portal.html` (and `src/styles.css` for the studio) to the Polar Marketing tokens:

| old variable | Polar Marketing token |
| --- | --- |
| `--bg` | `--bg` |
| `--card`, `--surface` | `--surface` |
| `--field`, `--surface-2` | `--surface-2` |
| `--ink` | `--ink` |
| `--muted`, `--ink-2` | `--ink-2` |
| `--line` | `--line` (decorative) or `--line-strong` (control edges) |
| `--accent`, `--accent-dark` | `--brand`, `--brand-hover` |
| `--accent-soft` | `--brand-soft` |
| `--on-accent` | `--on-brand` |
| `--ring` | `--brand` |
| `--danger`, `--danger-soft` | `--bad`, `--bad-soft` |
| `--hero` (gradient) | `--basalt` (solid; the gradient is retired) |
| `--shadow` | `--shadow-card` |
| `--sans` | `--font-sans` (Figtree; Inter retired) |

Class mapping: `.submit` → `.cr-btn .cr-btn--primary .cr-btn--lg .cr-btn--block`; `.chip` → `.cr-chip`; `.btn-ghost` → `.cr-btn--soft`; `input, select, textarea` → `.cr-input`; `.err` → a `.cr-badge--bad` banner; `.steps li` → `.cr-card`.

Load fonts with one Google Fonts link: Bricolage Grotesque 600/700, Figtree 400-700, IBM Plex Mono 500.

Recommended for the generated client websites: pass `tokens.css` to the site-design prompt as the colour and type palette, then let the AI vary layout.
