// Drawing text for on-screen overlays (video scenes, offer posts): fitting, wrapping and boxed lines.
export const FONT = '"Avenir Next", "Helvetica Neue", Arial, "DejaVu Sans", "Liberation Sans", sans-serif';

export const clean = (s) => String(s ?? "").replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, "").replace(/\s+/g, " ").trim();
/** Keep a number and its unit or currency on one line ("1,50 €/kg", "25 %", "€ 12"). */
export const glue = (s) => s.replace(/(\d) (?=[€$£%]|kg\b|g\b|h\b|min\b|km\b|m\b|EUR\b|euros?\b)/gi, "$1\u00A0").replace(/([€$£]) (?=\d)/g, "$1\u00A0");

export function wrapLines(ctx, text, maxW) {
  const lines = [];
  let cur = "";
  for (const w of text.split(" ")) {
    const next = cur ? cur + " " + w : w;
    if (ctx.measureText(next).width <= maxW || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function fitText(ctx, text, { maxW, maxLines, size, min, weight = 800 }) {
  let lines = [];
  for (let s = size; s >= min; s -= 4) {
    ctx.font = `${weight} ${s}px ${FONT}`;
    lines = wrapLines(ctx, text, maxW);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxW)) return { size: s, lines };
  }
  return { size: min, lines: lines.slice(0, maxLines) };
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Each line on its own rounded box, centred. Returns the block height. */
export function boxedLines(ctx, { lines, size }, { cx, top, bg, fg, weight = 800 }) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lh = Math.round(size * 1.32), padX = Math.round(size * 0.38);
  lines.forEach((line, i) => {
    const w = ctx.measureText(line).width + padX * 2;
    const y = top + i * (lh + 8);
    ctx.fillStyle = bg;
    roundRect(ctx, cx - w / 2, y, w, lh, Math.round(size * 0.24));
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.fillText(line, cx, y + lh / 2 + size * 0.04);
  });
  return lines.length * (lh + 8) - 8;
}

