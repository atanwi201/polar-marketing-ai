// Offer posts from the business's own photo or video: their picture, with the offer written on top
// (badge, headline, price or detail, business name). Photos become a 1080x1350 Instagram post;
// videos become a 1080x1920 Reel/Short with the text layer, keeping their sound.
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FONT, clean, glue, fitText, roundRect } from "./draw.mjs";
import { ffmpeg, enqueueRender } from "./video.mjs";

const run = promisify(execFile);
const FFPROBE = () => (process.env.FFMPEG_PATH ?? "ffmpeg").replace(/ffmpeg$/, "ffprobe");
const ACCENT = "#ffcf4a";
const INK = "#14232a";
export const POST_SIZE = [1080, 1350];
export const MAX_CLIP_SECONDS = 90;

/** Left-aligned lines, each on its own rounded box. Returns the height used. */
function leftBoxes(ctx, { lines, size }, { x, top, bg, fg, weight = 800, padX = 0.34 }) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const lh = Math.round(size * 1.3), px = Math.round(size * padX), gap = Math.round(size * 0.12);
  lines.forEach((line, i) => {
    const y = top + i * (lh + gap);
    ctx.fillStyle = bg;
    roundRect(ctx, x, y, ctx.measureText(line).width + px * 2, lh, Math.round(size * 0.22));
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.fillText(line, x + px, y + lh / 2 + size * 0.04);
  });
  return lines.length * (lh + gap) - gap;
}

/** Plain left-aligned lines with a soft shadow (headline on a photo). Returns the height used. */
function shadowLines(ctx, { lines, size }, { x, top, color = "#fff", weight = 800 }) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = color;
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = Math.round(size * 0.3);
  const lh = Math.round(size * 1.08);
  lines.forEach((line, i) => ctx.fillText(line, x, top + i * lh));
  ctx.shadowBlur = 0;
  return lines.length * lh;
}

const prep = (s, max) => glue(clean(s)).slice(0, max);

/** The text block: badge, headline, subline and brand, laid out from `top` (or bottom-anchored). */
function measureBlock(ctx, t, maxW, sizes) {
  const badge = t.badge ? fitText(ctx, prep(t.badge, 24).toUpperCase(), { maxW, maxLines: 1, size: sizes.badge, min: 28 }) : null;
  const head = fitText(ctx, prep(t.headline, 80), { maxW, maxLines: 3, size: sizes.head, min: sizes.headMin });
  const sub = t.subline ? fitText(ctx, prep(t.subline, 80), { maxW: maxW - 40, maxLines: 2, size: sizes.sub, min: 30, weight: 700 }) : null;
  return { badge, head, sub };
}

/** Photo post: their photo (cover-cropped) with the offer at the bottom over a soft gradient. */
export async function composeOfferImage({ src, out, badge, headline, subline, brand, size = POST_SIZE }) {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const [W, H] = size;
  const img = await loadImage(src);
  const cv = createCanvas(W, H);
  const ctx = cv.getContext("2d");
  const k = Math.max(W / img.width, H / img.height);
  ctx.drawImage(img, (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k);

  const g = ctx.createLinearGradient(0, H * 0.38, 0, H);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(0.55, "rgba(0,0,0,0.45)");
  g.addColorStop(1, "rgba(0,0,0,0.78)");
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.38, W, H * 0.62);

  const X = 64, maxW = W - X * 2;
  const b = measureBlock(ctx, { badge, headline, subline }, maxW, { badge: 40, head: 96, headMin: 54, sub: 50 });
  if (b.badge) leftBoxes(ctx, b.badge, { x: 56, top: 56, bg: ACCENT, fg: INK });

  // Bottom-anchored: brand, then subline pill, then headline above it.
  const brandSize = 32;
  const brandY = H - 64 - brandSize;
  const subH = b.sub ? b.sub.lines.length * (Math.round(b.sub.size * 1.3) + Math.round(b.sub.size * 0.12)) : 0;
  const headH = b.head.lines.length * Math.round(b.head.size * 1.08);
  const subTop = brandY - 28 - subH;
  const headTop = subTop - (b.sub ? 22 : 0) - headH;
  shadowLines(ctx, b.head, { x: X, top: headTop });
  if (b.sub) leftBoxes(ctx, b.sub, { x: X, top: subTop, bg: ACCENT, fg: INK, weight: 700 });
  if (brand) {
    ctx.font = `600 ${brandSize}px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fillText(prep(brand, 70), X, brandY);
  }
  await writeFile(out, cv.toBuffer("image/jpeg", 90));
  return { width: W, height: H };
}

/** Transparent 1080x1920 text layer for a vertical clip, inside the Reels/Shorts safe zones. */
async function clipLayer({ badge, headline, subline, brand }, file) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const W = 1080, H = 1920, X = 90, maxW = W - X - 170;
  const cv = createCanvas(W, H);
  const ctx = cv.getContext("2d");
  const top = ctx.createLinearGradient(0, 0, 0, 900);
  top.addColorStop(0, "rgba(0,0,0,0.42)");
  top.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, 900);
  const b = measureBlock(ctx, { badge, headline, subline }, maxW, { badge: 44, head: 92, headMin: 56, sub: 54 });
  let y = 270;
  if (b.badge) y += leftBoxes(ctx, b.badge, { x: X, top: y, bg: ACCENT, fg: INK }) + 26;
  y += leftBoxes(ctx, b.head, { x: X, top: y, bg: "rgba(255,255,255,0.95)", fg: INK }) + 22;
  if (b.sub) y += leftBoxes(ctx, b.sub, { x: X, top: y, bg: ACCENT, fg: INK, weight: 700 }) + 22;
  if (brand) leftBoxes(ctx, { lines: [prep(brand, 60)], size: 34 }, { x: X, top: y + 6, bg: "rgba(12,24,30,0.72)", fg: "#fff", weight: 600 });
  await writeFile(file, cv.toBuffer("image/png"));
}

/** Duration, size and whether a video has sound. Throws for files that aren't videos. */
export async function probeVideo(src) {
  const { stdout } = await run(FFPROBE(), ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", src], { timeout: 30e3 });
  const j = JSON.parse(stdout);
  const v = (j.streams ?? []).find((s) => s.codec_type === "video");
  if (!v) throw new Error("That file has no video in it");
  return { duration: Number(j.format?.duration) || 0, width: v.width, height: v.height, audio: (j.streams ?? []).some((s) => s.codec_type === "audio") };
}

/** One frame of a video as a JPEG (to describe it, or as a cover). */
export async function videoFrame(src, out, at = 1) {
  await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-ss", String(at), "-i", src, "-frames:v", "1", "-vf", "scale=720:-2", "-q:v", "3", out], 60e3);
  return out;
}

/** Their video as a vertical Reel/Short with the offer on top. Keeps their sound; max 90 seconds. */
export async function composeOfferVideo({ src, out, cover, badge, headline, subline, brand }) {
  const info = await probeVideo(src);
  const seconds = Math.min(info.duration || MAX_CLIP_SECONDS, MAX_CLIP_SECONDS);
  const work = await mkdtemp(join(tmpdir(), "isla-clip-"));
  try {
    const layer = join(work, "layer.png");
    await clipLayer({ badge, headline, subline, brand }, layer);
    const f = [
      "[0:v]split=2[a][b]",
      "[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=32:2,eq=brightness=-0.06[bg]",
      "[b]scale=1080:1920:force_original_aspect_ratio=decrease[fg]",
      "[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[base]",
      "[1:v]format=rgba,fade=t=in:st=0.2:d=0.4:alpha=1[txt]",
      "[base][txt]overlay=0:0:format=auto,fps=30,scale=out_range=tv,format=yuv420p[v]",
    ];
    const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", src, "-loop", "1", "-framerate", "30", "-t", String(seconds), "-i", layer];
    if (!info.audio) args.push("-f", "lavfi", "-t", String(seconds), "-i", "anullsrc=r=48000:cl=stereo");
    args.push("-filter_complex", f.join(";"), "-map", "[v]", "-map", info.audio ? "0:a:0" : "2:a",
      "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p", "-r", "30", "-g", "60",
      "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-t", String(seconds), out);
    await enqueueRender(() => ffmpeg(args));
    await ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-ss", String(Math.min(1, seconds / 2)), "-i", out, "-frames:v", "1", "-q:v", "3", cover], 60e3);
    return { duration: seconds };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
