// Apple Wallet passes: env check and a signed .pkpass built from a loyalty programme's Design.
import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { PKPass } from "passkit-generator";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { MEDIA_DIR } from "./store.mjs";

/** A PEM from `<NAME>_PATH` or `<NAME>_BASE64`, or "" when neither is set/readable. */
export function readPem(env, name) {
  const b64 = env[`${name}_BASE64`], path = env[`${name}_PATH`];
  if (b64) return Buffer.from(b64, "base64").toString("utf8");
  if (path && existsSync(path)) return readFileSync(path, "utf8");
  return "";
}

const has = (env, name) => !!(env[`${name}_BASE64`] || (env[`${name}_PATH`] && existsSync(env[`${name}_PATH`])));

export function walletStatus(env = process.env) {
  const missing = [];
  if (!env.APPLE_PASS_TYPE_ID) missing.push("APPLE_PASS_TYPE_ID");
  if (!env.APPLE_TEAM_ID) missing.push("APPLE_TEAM_ID");
  if (!has(env, "APPLE_PASS_CERT")) missing.push("APPLE_PASS_CERT_PATH");
  if (!has(env, "APPLE_PASS_KEY")) missing.push("APPLE_PASS_KEY_PATH");
  if (!has(env, "APPLE_WWDR")) missing.push("APPLE_WWDR_PATH");
  const configured = missing.length === 0;
  const publicUrlHttps = /^https:\/\//i.test(env.PUBLIC_URL ?? "");
  return { configured, missing, passTypeId: env.APPLE_PASS_TYPE_ID ?? "", pushReady: configured && publicUrlHttps, publicUrlHttps };
}

const rgb = (hex, fallback) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  const h = m ? m[1] : fallback;
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
};
const hexOr = (hex, fallback) => (/^#[0-9a-f]{6}$/i.test(hex ?? "") ? hex : fallback);

async function mediaImage(file) {
  if (!file) return null;
  const p = join(MEDIA_DIR, basename(file));
  if (!existsSync(p)) return null;
  try { return await loadImage(readFileSync(p)); } catch { return null; }
}

/** Draw `img` scaled to cover (or fit inside) the box. */
function drawImage(ctx, img, x, y, w, h, mode) {
  const s = (mode === "cover" ? Math.max : Math.min)(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

const png = (canvas) => canvas.toBuffer("image/png");

async function iconImages(design, client) {
  const logo = await mediaImage(design.logoFile || client?.logoFile);
  const out = {};
  for (const [name, size] of [["icon.png", 29], ["icon@2x.png", 58], ["icon@3x.png", 87]]) {
    const c = createCanvas(size, size), ctx = c.getContext("2d");
    ctx.fillStyle = hexOr(design.accent, "#ff6b35");
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.fill();
    if (logo) {
      ctx.save(); ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, size, size);
      drawImage(ctx, logo, size * 0.1, size * 0.1, size * 0.8, size * 0.8, "fit");
      ctx.restore();
    } else {
      ctx.fillStyle = "#ffffff"; ctx.font = `bold ${Math.round(size * 0.55)}px sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(((client?.name ?? design.cardTitle ?? "?").trim()[0] ?? "?").toUpperCase(), size / 2, size / 2 + size * 0.04);
    }
    out[name] = png(c);
  }
  return { icons: out, logo };
}

function logoImages(logo) {
  if (!logo) return {};
  const out = {};
  for (const [name, k] of [["logo.png", 1], ["logo@2x.png", 2], ["logo@3x.png", 3]]) {
    const w = 160 * k, h = 50 * k, c = createCanvas(w, h), ctx = c.getContext("2d");
    drawImage(ctx, logo, 0, 0, w, h, "fit");
    out[name] = png(c);
  }
  return out;
}

/** The strip: a row (or two) of stamps for stamp cards, the banner image for points cards. */
async function stripImages(design, program, customer) {
  const type = program.type;
  const showStamps = type === "stamps" || (type === "custom" && (program.stamps?.goal ?? 0) > 0 && !(program.points?.perEuro > 0));
  const img = design.layout === "minimal" ? null : await mediaImage(design.stripFile || design.backgroundFile);
  if (!showStamps && !img) return {};
  const out = {};
  for (const [name, k] of [["strip.png", 1], ["strip@2x.png", 2], ["strip@3x.png", 3]]) {
    const w = 375 * k, h = 123 * k, c = createCanvas(w, h), ctx = c.getContext("2d");
    ctx.fillStyle = hexOr(design.background, "#222222"); ctx.fillRect(0, 0, w, h);
    if (img) {
      drawImage(ctx, img, 0, 0, w, h, "cover");
      if (showStamps) { ctx.fillStyle = hexOr(design.background, "#222222"); ctx.globalAlpha = 0.65; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; }
    }
    if (showStamps) drawStamps(ctx, w, h, Math.max(1, program.stamps?.goal ?? 8), customer.stamps ?? 0, design);
    out[name] = png(c);
  }
  return out;
}

function drawStamps(ctx, w, h, goal, have, design) {
  const rows = goal > 10 ? 2 : 1, perRow = Math.ceil(goal / rows);
  const cell = Math.min(w / perRow, h / rows), r = cell * 0.36;
  const accent = hexOr(design.accent, "#ff6b35"), fg = hexOr(design.foreground, "#ffffff");
  for (let i = 0; i < goal; i++) {
    const row = Math.floor(i / perRow), inRow = row === rows - 1 ? goal - row * perRow : perRow;
    const x = (w - inRow * cell) / 2 + (i - row * perRow) * cell + cell / 2;
    const y = (h - rows * cell) / 2 + row * cell + cell / 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (i < have) {
      ctx.fillStyle = accent; ctx.fill();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = r * 0.22; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); ctx.moveTo(x - r * 0.4, y); ctx.lineTo(x - r * 0.1, y + r * 0.32); ctx.lineTo(x + r * 0.45, y - r * 0.32); ctx.stroke();
    } else {
      ctx.strokeStyle = fg; ctx.globalAlpha = 0.55; ctx.lineWidth = r * 0.14; ctx.setLineDash([r * 0.3, r * 0.3]); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
  }
}

const field = (key, label, value) => ({ key, label, value: String(value) });

function nextReward(program, customer) {
  const rewards = (program.rewards ?? []).filter((r) => r.active !== false);
  const bal = (r) => (r.kind === "points" ? customer.points ?? 0 : customer.stamps ?? 0);
  const ready = rewards.find((r) => bal(r) >= r.cost);
  if (ready) return `${ready.name}: ready to claim`;
  const next = rewards.slice().sort((a, b) => (a.cost - bal(a)) - (b.cost - bal(b)))[0];
  if (!next) return "";
  const left = next.cost - bal(next);
  return `${next.name}: ${left} ${next.kind === "points" ? "points" : left === 1 ? "stamp" : "stamps"} to go`;
}

const stampRow = (have, goal, design) => {
  const full = design.stampIcon || "●", empty = design.stampEmptyIcon || "○";
  const n = Math.min(goal, 20);
  return Array.from({ length: n }, (_, i) => (i < have ? full : empty)).join(" ");
};

/** Build the pass.json object. */
export function passJson({ program, customer, client, baseUrl, env = process.env }) {
  const design = program.design ?? {};
  const code = `LC1-${customer.id}`;
  const usesStamps = program.type === "stamps" || program.type === "custom";
  const usesPoints = program.type === "points" || program.type === "custom";
  const goal = program.stamps?.goal ?? 8;
  const base = (env.PUBLIC_URL || baseUrl || "").replace(/\/$/, "");
  const j = {
    formatVersion: 1,
    passTypeIdentifier: env.APPLE_PASS_TYPE_ID,
    teamIdentifier: env.APPLE_TEAM_ID,
    serialNumber: customer.id,
    organizationName: client?.name || design.cardTitle || program.name,
    description: design.cardTitle || program.name,
    logoText: client?.name || design.cardTitle || program.name,
    backgroundColor: rgb(design.background, "222222"),
    foregroundColor: rgb(design.foreground, "ffffff"),
    labelColor: rgb(design.label || design.foreground, "cccccc"),
    barcodes: [{ format: "PKBarcodeFormatQR", message: code, messageEncoding: "iso-8859-1", altText: code }],
    barcode: { format: "PKBarcodeFormatQR", message: code, messageEncoding: "iso-8859-1", altText: code },
    sharingProhibited: true,
  };
  if (customer.authToken && customer.authToken.length >= 16) j.authenticationToken = customer.authToken;
  if (/^https:\/\//i.test(base) && j.authenticationToken) j.webServiceURL = `${base}/wallet`;
  const lat = Number(client?.lat ?? client?.latitude), lon = Number(client?.lng ?? client?.lon ?? client?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon)) j.locations = [{ latitude: lat, longitude: lon, relevantText: design.tagline || `Show your card at ${j.organizationName}` }];

  const header = [], primary = [], secondary = [], auxiliary = [];
  if (usesStamps && !(usesPoints && program.type === "custom" && !program.stamps?.goal)) {
    header.push(field("stamps", "STAMPS", `${customer.stamps ?? 0}/${goal}`));
    primary.push(field("stampsPrimary", design.tagline ? design.tagline.slice(0, 24).toUpperCase() : "STAMPS", `${customer.stamps ?? 0} of ${goal}`));
    secondary.push(field("stampRow", "YOUR STAMPS", stampRow(customer.stamps ?? 0, goal, design)));
  }
  if (usesPoints) {
    header.push(field("points", "POINTS", customer.points ?? 0));
    if (!primary.length) primary.push(field("pointsPrimary", "POINTS", customer.points ?? 0));
  }
  if (program.type === "custom" && customer.tier) auxiliary.push(field("tier", "TIER", customer.tier));
  const nr = nextReward(program, customer);
  if (nr) auxiliary.push(field("nextReward", "NEXT REWARD", nr));
  if (customer.name) auxiliary.push(field("member", "MEMBER", customer.name));
  if (!secondary.length && auxiliary.length) secondary.push(auxiliary.shift());

  const rewardLines = (program.rewards ?? []).filter((r) => r.active !== false).map((r) => `${r.name} (${r.cost} ${r.kind})${r.description ? `: ${r.description}` : ""}`).join("\n");
  const back = [];
  if (design.tagline) back.push(field("about", "About", design.tagline));
  if (rewardLines) back.push(field("rewards", "Rewards", rewardLines));
  if (program.terms) back.push(field("terms", "Terms and conditions", program.terms));
  back.push(field("code", "Card code", code));
  if (base) back.push({ key: "card", label: "Your card online", value: customer.cardToken ? `${base}/card/${customer.cardToken}` : base, dataDetectorTypes: ["PKDataDetectorTypeLink"] });

  j.storeCard = { headerFields: header, primaryFields: primary, secondaryFields: secondary, auxiliaryFields: auxiliary, backFields: back };
  return j;
}

/** A signed .pkpass (zip) for this customer's card. Throws when the wallet is not configured. */
export async function buildPass({ program, customer, client, baseUrl, env = process.env }) {
  const st = walletStatus(env);
  if (!st.configured) throw Object.assign(new Error(`Apple Wallet is not set up (missing ${st.missing.join(", ")})`), { status: 404 });
  const design = program.design ?? {};
  const { icons, logo } = await iconImages(design, client);
  const files = {
    "pass.json": Buffer.from(JSON.stringify(passJson({ program, customer, client, baseUrl, env }))),
    ...icons, ...logoImages(logo), ...(await stripImages(design, program, customer)),
  };
  const pass = new PKPass(files, {
    wwdr: readPem(env, "APPLE_WWDR"),
    signerCert: readPem(env, "APPLE_PASS_CERT"),
    signerKey: readPem(env, "APPLE_PASS_KEY"),
    ...(env.APPLE_PASS_KEY_PASSPHRASE ? { signerKeyPassphrase: env.APPLE_PASS_KEY_PASSPHRASE } : {}),
  });
  return pass.getAsBuffer();
}
