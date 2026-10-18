// Art directions for client websites, modelled on the styles curated on SiteInspire
// (siteinspire.com: Typographic, Minimal, Grid Layout, Unusual Layout, Photographic, Colourful,
// Dark...). Every site gets one, picked to suit the style the business chose, so sites don't all look
// alike. A rebuild keeps the direction; "New AI design" picks a different one.
import { randomInt } from "node:crypto";

export const DIRECTIONS = [
  {
    id: "editorial", name: "Editorial magazine", tags: "Typographic, Editorial", fits: ["elegant", "warm", "modern"],
    spec: [
      "Paper-like off-white background (a very light warm tint), ink-dark text; the primary colour is used sparingly for rules, links and small details.",
      "Fonts: a high-contrast serif display face (Fraunces, Playfair Display or Instrument Serif) at huge sizes, with a clean sans for body (Inter or Instrument Sans).",
      "Hero: split layout with no overlay. Left 7/12: a huge serif h1 (clamp(3rem, 8vw, 7.5rem), line-height .95, letter-spacing -.03em) with one key word in italic, then the supporting line and the buttons. Right 5/12: the hero image cropped tall (aspect-ratio 4/5, object-fit cover) with a small-caps caption underneath.",
      "Section eyebrows are numbered (\"01 — \", \"02 — \"...) and sections are separated by 1px hairline rules across the container.",
      "Products and services as a menu: name in the serif on the left, a dotted leader line, the price on the right, a short description in small text below.",
      "Gallery as an asymmetric magazine spread: one wide image and two portrait images offset vertically from each other.",
      "About: a drop cap on the first paragraph (::first-letter) and one pull quote in large italic serif (only words from their own description or story).",
      "FAQ as a hairline-separated list with a +/− marker.",
      "Footer: the business name as a giant serif wordmark across the full width (about 12vw), small contact details beneath.",
    ],
  },
  {
    id: "swiss", name: "Swiss grid", tags: "Minimal, Grid Layout", fits: ["modern", "bold"],
    spec: [
      "White background, near-black text, the primary colour only for solid blocks, labels and the main button.",
      "Fonts: one grotesk family for everything (Inter Tight, Manrope or Space Grotesk headings with Inter body). Square corners everywhere (radius 0 or 4px).",
      "A strict 12-column grid; thin 1px hairlines separate sections and cells, like a printed Swiss poster.",
      "Hero: a thin row of tiny uppercase metadata across the columns (town · opening hours · phone), then a giant left-aligned h1 (clamp(3rem, 9vw, 8rem), weight 600, letter-spacing -.04em) spanning 10 columns, then a full-width image strip below it (aspect-ratio 21/9, object-fit cover). No overlay.",
      "Highlights as a row of 4 numbered cells (01, 02...) divided by hairlines.",
      "Products and services as a table-like grid: name | description | price, hairline dividers, prices right-aligned with tabular numbers.",
      "Gallery as a uniform grid of square tiles with no rounded corners.",
      "Buttons are rectangular, solid ink or primary, with a → arrow; links get an underline that slides in on hover.",
      "Footer in columns with tiny uppercase headings.",
    ],
  },
  {
    id: "photographic", name: "Photo-led, full bleed", tags: "Photographic, Minimal", fits: ["natural", "modern", "elegant"], minImages: 3,
    spec: [
      "The photos lead: restrained palette (white, near-black, the primary colour as an accent), plenty of air, minimal chrome.",
      "Fonts: an elegant modern sans or a light serif for headings (e.g. Manrope, Instrument Serif or DM Serif Display) with a neutral sans body.",
      "Hero: full-bleed, 92vh, the hero image covering it with a soft dark gradient from the bottom; the h1 sits at the bottom-left (clamp(3rem, 7vw, 6.5rem)) with the buttons beside or below; a small caption with the town in the top-right corner.",
      "Between text sections, full-bleed image bands (an <img> with aspect-ratio 16/7 and object-fit cover).",
      "Gallery as a horizontal scroll-snap strip of large images (overflow-x: auto on the strip only, scroll-snap-type x mandatory; each item about 75vw on phones and 36vw on desktop) with small captions. The page itself must never scroll sideways.",
      "Products and services as clean cards; where a photo fits, the name and price sit on the photo with a gradient behind them.",
      "Footer simple and quiet, on near-black.",
    ],
  },
  {
    id: "colourblock", name: "Bold colour blocks", tags: "Colourful, Flat Design", fits: ["bold", "warm"],
    spec: [
      "Each section has its own saturated background taken from the primary, the accent and their tints; text is ink or white, whichever passes contrast.",
      "Fonts: chunky display sans for headings (Archivo Black, Bricolage Grotesque or Unbounded; uppercase is fine) with Inter or DM Sans body.",
      "Friendly neo-brutalist details: 2px ink borders, offset hard shadows (box-shadow: 6px 6px 0 var(--ink)), cards with radius 24-32px that shift on hover.",
      "Hero: split layout. Left: a colour block with the h1 (clamp(2.8rem, 7vw, 6rem)) and the buttons. Right: the hero image inside an arch mask (border-radius: 999px 999px 32px 32px) with a tilted round sticker (rotate -8deg) showing the slogan or town.",
      "Right after the hero, a CSS marquee strip repeating their products or keywords (@keyframes translateX, duplicated content, paused under prefers-reduced-motion).",
      "Products and services as chunky cards with the price on a sticker-like badge.",
      "Gallery tiles with thick borders and slight alternating rotations (±1.5deg) that straighten on hover.",
    ],
  },
  {
    id: "artisanal", name: "Warm artisanal", tags: "Typographic, Illustrated", fits: ["warm", "natural"],
    spec: [
      "Cream paper background, deep brown or ink text, the primary colour as an earthy accent.",
      "Fonts: a soft serif display (Fraunces or DM Serif Display) with a humanist sans (Nunito Sans or DM Sans); a handwritten font (Caveat) for at most two or three short notes.",
      "Photos in arch masks (border-radius: 50% 50% 16px 16px / 30% 30% 16px 16px) and soft round frames.",
      "Hero: centred, a large serif h1, a handwritten note beside it, the hero image in a big arch below or to the side, and a round stamp-like badge with the town name (CSS circle, rotated text not needed).",
      "Wavy inline-SVG dividers between some sections.",
      "Products and services as a menu card: either a dark chalkboard panel (deep green or brown, light text) or a paper card with dotted leaders and prices.",
      "Generous warmth: rounded buttons, gentle hover lifts, small inline SVG doodles (leaf, sun, star) as accents.",
    ],
  },
  {
    id: "darkluxe", name: "Dark luxe", tags: "Dark, Minimal", fits: ["elegant"],
    spec: [
      "Near-black background (or a very dark tone of the primary), ivory text, the accent colour for hairlines, small labels and hover states.",
      "Fonts: a refined serif (Cormorant Garamond or Playfair Display) in large, light weights, with small uppercase sans labels (Lato or Inter, letter-spacing .2em).",
      "Hero: full height, the image darkened, a centred thin-weight h1, and a 1px frame inset about 24px around the whole hero.",
      "A lot of space, fine lines, images in overflow-hidden frames that zoom slightly on hover (scale 1.04).",
      "Products and services as an elegant two-column list with fine dividers and prices in the accent colour.",
      "Every section stays dark (vary between two dark tones), with one ivory band for contrast.",
    ],
  },
  {
    id: "bento", name: "Bento grid", tags: "Unusual Layout, Grid Layout", fits: ["modern", "bold"],
    spec: [
      "Light grey page background with white tiles, radius 28px, soft shadows; one tile in the primary colour and one dark tile for rhythm.",
      "Fonts: a geometric sans (Plus Jakarta Sans, Manrope or Space Grotesk).",
      "Hero as a bento grid built with grid-template-areas: a big tile with the h1 and the buttons (2 columns × 2 rows), a tile with the hero image, a tile with the opening hours, a tile with the slogan or a highlight, and a WhatsApp tile. It collapses to one column on phones.",
      "Highlights, products and services also as bento tiles of mixed sizes; prices large in the tiles.",
      "Gallery as a mosaic of tiles with different spans.",
      "Small details: tiles lift on hover, tiny uppercase labels at the top of each tile.",
    ],
  },
  {
    id: "fresh", name: "Fresh and organic", tags: "Minimal, Colourful", fits: ["natural", "warm", "modern"],
    spec: [
      "Very light tints of the primary colour as backgrounds, white cards, soft organic blob shapes (border-radius: 40% 60% 55% 45% / 50% 45% 55% 50%) behind photos.",
      "Fonts: friendly rounded sans headings (Outfit, Bricolage Grotesque or DM Sans) with a clean body sans.",
      "Hero: split layout, text left with a large h1 (clamp(2.8rem, 6vw, 5.4rem)), image right in a blob frame, with two small floating cards overlapping its corner (e.g. the opening hours and a WhatsApp prompt).",
      "Large rounded images (radius 32px) and wavy inline-SVG dividers between sections.",
      "Products and services as rounded cards with a soft tinted icon circle and the price in a pill.",
      "Gallery in a soft masonry-style grid with rounded corners.",
    ],
  },
];

const byId = Object.fromEntries(DIRECTIONS.map((d) => [d.id, d]));

/** The direction for this build: keep the current one unless a new design is asked for. */
export function pickDirection({ style = "modern", images = 0, current, newDesign = false } = {}) {
  if (!newDesign && byId[current]) return byId[current];
  let pool = DIRECTIONS.filter((d) => d.fits.includes(style) && images >= (d.minImages ?? 0));
  if (!pool.length) pool = DIRECTIONS.filter((d) => images >= (d.minImages ?? 0));
  const fresh = pool.filter((d) => d.id !== current);
  const list = fresh.length ? fresh : pool;
  return list[randomInt(list.length)];
}

export const directionPrompt = (d) => `## Art direction: ${d.name}
In the spirit of the best sites featured on SiteInspire (siteinspire.com) in the ${d.tags} styles: a distinctive, confident look that a design-award jury would notice, not a generic template.
${d.spec.map((s) => `- ${s}`).join("\n")}`;
