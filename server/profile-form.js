// The business information form, shared by the sign-up page and the business's dashboard.
// Plain JS, no build step. ProfileForm.mount(el, { lang, values, sections }) renders the fields;
// .collect() returns what to send to the server; .problem(section) checks required fields.
(() => {
"use strict";
const T = {
  es: {
    brand: "Tu marca", offer: "Qué ofreces", place: "Dónde y cuándo", photos: "Fotos",
    logo: "Logo", logoHint: "PNG o JPG. Si tiene fondo transparente, mejor.", logoPick: "Subir logo", logoChange: "Cambiar logo", remove: "Quitar",
    tagline: "Eslogan o frase corta", taglinePh: "La fruta más fresca del mercado",
    style: "Estilo de la web", colors: "Colores", useLogo: "Usar los colores de mi logo", primary: "Color principal", accent: "Color de acento",
    styles: { modern: ["Moderno", "Limpio y minimalista"], warm: ["Cálido", "Cercano y acogedor"], bold: ["Atrevido", "Colores vivos, mucha energía"], elegant: ["Elegante", "Premium y refinado"], natural: ["Natural", "Fresco, verde y luminoso"] },
    offerLbl: "Describe tu negocio", offerPh: "Qué vendes o qué servicios ofreces, para quién, qué os hace diferentes…",
    services: "Productos o servicios con precio", servicesHint: "Aparecerán en tu web tal cual. Deja el precio vacío si no quieres mostrarlo.",
    sName: "Nombre", sPrice: "Precio", sDesc: "Descripción corta (opcional)", addService: "Añadir otro",
    usps: "¿Qué os hace especiales?", uspsPh: "Producto local, años de experiencia, trato familiar, entrega a domicilio…",
    story: "Vuestra historia", storyPh: "Cómo empezasteis, quién está detrás, qué os mueve…", since: "Desde qué año", sincePh: "1998",
    address: "Dirección", addressPh: "Calle, número, local · o el nombre del mercado o centro comercial",
    hours: "Horario", hoursPh: "Lun-Sáb 8:00-14:00 · Dom cerrado",
    booking: "Enlace para reservar (opcional)", menu: "Enlace a carta o catálogo (opcional)",
    social: "Redes sociales y reseñas", examples: "Webs que te gustan (ejemplos)", examplesHint: "Pega hasta 3 enlaces, uno por línea. Nos inspiramos en su estilo, no copiamos nada.", payment: "Formas de pago", paymentPh: "Efectivo, tarjeta, Bizum",
    extras: "Otros datos útiles", extrasPh: "Aparcamiento, entrega a domicilio, accesible, se admiten perros, idiomas…",
    photosHint: "Fotos reales de tu negocio, productos, equipo o local. Las fotos reales hacen la web mucho mejor; si faltan, usamos fotos de stock.", addPhotos: "Añadir fotos", max: "Máximo {n} fotos",
    optional: "opcional",
  },
  en: {
    brand: "Your brand", offer: "What you offer", place: "Where and when", photos: "Photos",
    logo: "Logo", logoHint: "PNG or JPG. A transparent background is best.", logoPick: "Upload logo", logoChange: "Change logo", remove: "Remove",
    tagline: "Slogan or short line", taglinePh: "The freshest fruit in the market",
    style: "Website style", colors: "Colours", useLogo: "Use the colours of my logo", primary: "Main colour", accent: "Accent colour",
    styles: { modern: ["Modern", "Clean and minimal"], warm: ["Warm", "Friendly and welcoming"], bold: ["Bold", "Bright colours, lots of energy"], elegant: ["Elegant", "Premium and refined"], natural: ["Natural", "Fresh, green and light"] },
    offerLbl: "Describe your business", offerPh: "What you sell or which services you offer, for whom, what makes you different…",
    services: "Products or services with prices", servicesHint: "They appear on your website as written. Leave the price empty to hide it.",
    sName: "Name", sPrice: "Price", sDesc: "Short description (optional)", addService: "Add another",
    usps: "What makes you special?", uspsPh: "Local produce, years of experience, family run, home delivery…",
    story: "Your story", storyPh: "How you started, who's behind it, what drives you…", since: "Since (year)", sincePh: "1998",
    address: "Address", addressPh: "Street, number, unit · or the market or shopping centre",
    hours: "Opening hours", hoursPh: "Mon-Sat 8:00-14:00 · Sun closed",
    booking: "Booking link (optional)", menu: "Menu or catalogue link (optional)",
    social: "Social media and reviews", examples: "Websites you like (examples)", examplesHint: "Paste up to 3 links, one per line. We take inspiration from their style, we never copy anything.", payment: "Payment methods", paymentPh: "Cash, card, Bizum",
    extras: "Other useful details", extrasPh: "Parking, home delivery, accessible, dogs welcome, languages…",
    photosHint: "Real photos of your business, products, team or place. Real photos make the website much better; we fill any gaps with stock photos.", addPhotos: "Add photos", max: "Up to {n} photos",
    optional: "optional",
  },
};
const SOCIAL = [["instagram", "Instagram", "instagram.com/…"], ["facebook", "Facebook", "facebook.com/…"], ["tiktok", "TikTok", "tiktok.com/@…"], ["google", "Google Maps", "maps.app.goo.gl/…"], ["tripadvisor", "Tripadvisor", "tripadvisor.es/…"]];
const STYLES = ["modern", "warm", "bold", "elegant", "natural"];
const SWATCH = { modern: ["#1f3a5f", "#f2a541"], warm: ["#8a4b2a", "#e9b44c"], bold: ["#d7263d", "#1b998b"], elegant: ["#1d1d1f", "#b08d57"], natural: ["#2f6b3b", "#e3b23c"] };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const CSS = `
.pf{display:flex;flex-direction:column;gap:22px}
.pf-sec{display:flex;flex-direction:column;gap:14px}
.pf-sec>h3{font:700 19px var(--display,inherit);letter-spacing:-.01em;margin:0}
.pf-f{display:flex;flex-direction:column;gap:6px}
.pf-f>span.l{font-weight:600;font-size:13.5px;color:var(--muted);margin-left:4px}
.pf-f>span.l small{font-weight:400;color:var(--faint)}
.pf-hint{font-size:12.5px;color:var(--muted);margin:0 0 0 4px}
.pf input[type=text],.pf input[type=url],.pf textarea{width:100%;font:16px inherit;font-family:inherit;color:var(--ink);background:var(--fill);border:2px solid transparent;border-radius:14px;padding:11px 13px;min-height:48px}
.pf textarea{min-height:96px;resize:vertical}
.pf input:focus,.pf textarea:focus{outline:none;border-color:var(--accent);background:var(--card)}
.pf-two{display:grid;gap:12px}@media(min-width:560px){.pf-two{grid-template-columns:1fr 1fr}}
.pf-logo{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.pf-logo .prev{width:84px;height:84px;border-radius:18px;background:var(--fill) center/contain no-repeat;border:1px dashed var(--line,#ddd);display:grid;place-items:center;color:var(--faint);font-size:12px}
.pf-btn{display:inline-flex;align-items:center;gap:8px;min-height:42px;padding:0 15px;border-radius:999px;border:0;background:var(--fill);color:var(--ink);font:600 14px inherit;font-family:inherit;cursor:pointer}
.pf-btn.sm{min-height:34px;padding:0 12px;font-size:13px}
.pf-link{border:0;background:none;color:var(--accent-text,var(--accent));font:600 14px inherit;font-family:inherit;cursor:pointer;padding:6px}
.pf-file{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden}
.pf-file:focus-visible+.pf-btn{outline:3px solid var(--accent);outline-offset:2px}
.pf-styles{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
.pf-style{display:flex;flex-direction:column;gap:6px;text-align:left;padding:10px 12px;border-radius:16px;border:2px solid transparent;background:var(--fill);cursor:pointer;color:var(--ink);font-family:inherit}
.pf-style[aria-checked=true]{border-color:var(--accent);background:var(--card)}
.pf-style b{font-size:14.5px}.pf-style small{color:var(--muted);font-size:12.5px}
.pf-sw{display:flex;gap:4px}.pf-sw i{width:22px;height:8px;border-radius:4px;display:block}
.pf-colors{display:flex;gap:14px;flex-wrap:wrap;align-items:center}
.pf-colors label{display:flex;align-items:center;gap:8px;font-size:14px}
.pf-colors input[type=color]{width:42px;height:34px;border:0;border-radius:10px;background:none;padding:0;cursor:pointer}
.pf-check{display:flex;align-items:center;gap:10px;font-size:14.5px;cursor:pointer}
.pf-check input{width:20px;height:20px;accent-color:var(--accent)}
.pf-svc{display:grid;grid-template-columns:1fr 110px auto;gap:8px;align-items:start;background:var(--fill);border-radius:16px;padding:8px}
.pf-svc input{background:var(--card)!important}
.pf-svc .d{grid-column:1/3}
.pf-svc .x{grid-row:1;grid-column:3}
.pf-photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}
.pf-ph{position:relative;aspect-ratio:1;border-radius:14px;overflow:hidden;background:var(--fill)}
.pf-ph img{width:100%;height:100%;object-fit:cover;display:block}
.pf-ph button{position:absolute;top:6px;right:6px;width:28px;height:28px;border-radius:50%;border:0;background:rgba(0,0,0,.6);color:#fff;font-size:16px;line-height:1;cursor:pointer}
.pf-soc{display:grid;gap:10px}@media(min-width:560px){.pf-soc{grid-template-columns:1fr 1fr}}
`;

function downscale(file, max = 1600, q = 0.85, type = "image/jpeg") {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight; const k = Math.min(1, max / Math.max(w, h));
      w = Math.round(w * k); h = Math.round(h * k);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const x = c.getContext("2d");
      if (type === "image/jpeg") { x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); }
      x.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url); res(c.toDataURL(type, q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("img")); };
    img.src = url;
  });
}

function mount(root, { lang = "es", values = {}, sections = ["brand", "offer", "place", "photos"], maxPhotos = 12, requireOffer = false } = {}) {
  if (!document.getElementById("pf-css")) { const s = document.createElement("style"); s.id = "pf-css"; s.textContent = CSS; document.head.appendChild(s); }
  const p = values.profile ?? {};
  const st = {
    lang, logo: values.logoData ?? null, logoFile: values.logoFile || "", logoRemoved: !!values.logoRemoved,
    style: p.style || "", useLogoColors: !(p.colors?.primary), primary: p.colors?.primary || "#2f6b3b", accent: p.colors?.accent || "#e3b23c",
    services: (p.services?.length ? p.services : [{ name: "", price: "", description: "" }]).map((x) => ({ ...x })),
    photos: values.photoItems ?? (values.photos ?? []).map((f) => ({ file: f })), removed: values.removed ?? [],
  };
  const t = (k) => T[st.lang][k] ?? k;
  const v = (k, d = "") => esc(p[k] ?? d);

  const sec = {
    brand: () => `<section class="pf-sec" data-sec="brand"><h3>${t("brand")}</h3>
      <div class="pf-f"><span class="l">${t("logo")} <small>(${t("optional")})</small></span>
        <div class="pf-logo"><span class="prev" id="pf-logo-prev"></span>
          <input type="file" id="pf-logo" class="pf-file" accept="image/png,image/jpeg,image/webp"><label for="pf-logo" class="pf-btn" id="pf-logo-lbl"></label>
          <button type="button" class="pf-link" id="pf-logo-rm" hidden>${t("remove")}</button></div>
        <p class="pf-hint">${t("logoHint")}</p></div>
      <label class="pf-f"><span class="l">${t("tagline")}</span><input type="text" id="pf-tagline" maxlength="140" placeholder="${esc(t("taglinePh"))}" value="${v("tagline")}"></label>
      <div class="pf-f"><span class="l">${t("style")}</span><div class="pf-styles" role="radiogroup" aria-label="${esc(t("style"))}">${STYLES.map((s) => `<button type="button" class="pf-style" role="radio" data-style="${s}" aria-checked="${st.style === s}"><span class="pf-sw"><i style="background:${SWATCH[s][0]}"></i><i style="background:${SWATCH[s][1]}"></i></span><b>${t("styles")[s][0]}</b><small>${t("styles")[s][1]}</small></button>`).join("")}</div></div>
      <div class="pf-f"><span class="l">${t("colors")}</span>
        <label class="pf-check"><input type="checkbox" id="pf-uselogo" ${st.useLogoColors ? "checked" : ""}> ${t("useLogo")}</label>
        <div class="pf-colors" id="pf-colors" ${st.useLogoColors ? "hidden" : ""}><label><input type="color" id="pf-primary" value="${esc(st.primary)}"> ${t("primary")}</label><label><input type="color" id="pf-accent" value="${esc(st.accent)}"> ${t("accent")}</label></div></div>
      <label class="pf-f"><span class="l">${t("examples")} <small>(${t("optional")})</small></span><textarea id="pf-examples" rows="3" maxlength="900" placeholder="https://…">${esc((values.profile?.examples ?? []).join("\n"))}</textarea><p class="pf-hint">${t("examplesHint")}</p></label>
    </section>`,
    offer: () => `<section class="pf-sec" data-sec="offer"><h3>${t("offer")}</h3>
      <label class="pf-f"><span class="l">${t("offerLbl")}${requireOffer ? " *" : ""}</span><textarea id="pf-offer" maxlength="2000" placeholder="${esc(t("offerPh"))}">${esc(values.offer ?? "")}</textarea></label>
      <div class="pf-f"><span class="l">${t("services")}</span><p class="pf-hint">${t("servicesHint")}</p><div id="pf-svcs" style="display:grid;gap:8px"></div>
        <div><button type="button" class="pf-btn sm" id="pf-addsvc">+ ${t("addService")}</button></div></div>
      <label class="pf-f"><span class="l">${t("usps")}</span><textarea id="pf-usps" maxlength="900" placeholder="${esc(t("uspsPh"))}">${v("usps")}</textarea></label>
      <div class="pf-two"><label class="pf-f"><span class="l">${t("story")}</span><textarea id="pf-story" maxlength="1500" placeholder="${esc(t("storyPh"))}">${v("story")}</textarea></label>
        <label class="pf-f"><span class="l">${t("since")}</span><input type="text" id="pf-since" maxlength="40" placeholder="${esc(t("sincePh"))}" value="${v("since")}"></label></div>
    </section>`,
    place: () => `<section class="pf-sec" data-sec="place"><h3>${t("place")}</h3>
      <label class="pf-f"><span class="l">${t("address")}</span><input type="text" id="pf-address" maxlength="200" placeholder="${esc(t("addressPh"))}" value="${v("address")}"></label>
      <label class="pf-f"><span class="l">${t("hours")}</span><input type="text" id="pf-hours" maxlength="300" placeholder="${esc(t("hoursPh"))}" value="${esc(values.hours ?? "")}"></label>
      <div class="pf-two"><label class="pf-f"><span class="l">${t("booking")}</span><input type="url" id="pf-booking" placeholder="https://…" value="${v("bookingUrl")}"></label>
        <label class="pf-f"><span class="l">${t("menu")}</span><input type="url" id="pf-menu" placeholder="https://…" value="${v("menuUrl")}"></label></div>
      <div class="pf-f"><span class="l">${t("social")}</span><div class="pf-soc">${SOCIAL.map(([k, n, ph]) => `<label class="pf-f"><span class="l">${n}</span><input type="url" data-social="${k}" placeholder="${ph}" value="${esc(p.social?.[k] ?? "")}"></label>`).join("")}</div></div>
      <div class="pf-two"><label class="pf-f"><span class="l">${t("payment")}</span><input type="text" id="pf-payment" maxlength="200" placeholder="${esc(t("paymentPh"))}" value="${v("payment")}"></label>
        <label class="pf-f"><span class="l">${t("extras")}</span><input type="text" id="pf-extras" maxlength="900" placeholder="${esc(t("extrasPh"))}" value="${v("extras")}"></label></div>
    </section>`,
    photos: () => `<section class="pf-sec" data-sec="photos"><h3>${t("photos")}</h3><p class="pf-hint">${t("photosHint")} ${t("max").replace("{n}", maxPhotos)}.</p>
      <div class="pf-photos" id="pf-photos"></div>
      <div><input type="file" id="pf-addph" class="pf-file" accept="image/*" multiple><label for="pf-addph" class="pf-btn">+ ${t("addPhotos")}</label></div>
    </section>`,
  };
  root.innerHTML = `<div class="pf">${sections.map((s) => sec[s]()).join("")}</div>`;
  const $ = (s) => root.querySelector(s);

  const drawLogo = () => {
    const prev = $("#pf-logo-prev"); if (!prev) return;
    const src = st.logo || (st.logoFile && !st.logoRemoved ? `/media/${encodeURIComponent(st.logoFile)}` : "");
    prev.style.backgroundImage = src ? `url("${src}")` : ""; prev.textContent = src ? "" : "Logo";
    $("#pf-logo-lbl").textContent = src ? t("logoChange") : t("logoPick");
    $("#pf-logo-rm").hidden = !src;
  };
  const drawSvcs = () => {
    const box = $("#pf-svcs"); if (!box) return;
    box.innerHTML = st.services.map((s, i) => `<div class="pf-svc" data-i="${i}"><input type="text" data-k="name" maxlength="80" placeholder="${esc(t("sName"))}" value="${esc(s.name)}"><input type="text" data-k="price" maxlength="40" placeholder="${esc(t("sPrice"))}" value="${esc(s.price)}"><button type="button" class="pf-link x" data-rm="${i}" aria-label="${esc(t("remove"))}">✕</button><input class="d" type="text" data-k="description" maxlength="300" placeholder="${esc(t("sDesc"))}" value="${esc(s.description)}"></div>`).join("");
  };
  const drawPhotos = () => {
    const box = $("#pf-photos"); if (!box) return;
    box.innerHTML = st.photos.map((ph, i) => `<div class="pf-ph"><img src="${esc(ph.data || `/media/${encodeURIComponent(ph.file)}`)}" alt=""><button type="button" data-rmph="${i}" aria-label="${esc(t("remove"))}">×</button></div>`).join("");
  };
  drawLogo(); drawSvcs(); drawPhotos();

  // Assigned (not added) so mounting again after a language switch doesn't double the handlers.
  root.onclick = (e) => {
    const sty = e.target.closest("[data-style]");
    if (sty) { st.style = sty.dataset.style; root.querySelectorAll("[data-style]").forEach((b) => b.setAttribute("aria-checked", String(b === sty))); }
    if (e.target.closest("#pf-addsvc") && st.services.length < 12) { collectSvcs(); st.services.push({ name: "", price: "", description: "" }); drawSvcs(); root.querySelector(`.pf-svc[data-i="${st.services.length - 1}"] input`)?.focus(); }
    const rm = e.target.closest("[data-rm]");
    if (rm) { collectSvcs(); st.services.splice(Number(rm.dataset.rm), 1); if (!st.services.length) st.services.push({ name: "", price: "", description: "" }); drawSvcs(); }
    const rp = e.target.closest("[data-rmph]");
    if (rp) { const [x] = st.photos.splice(Number(rp.dataset.rmph), 1); if (x?.file) st.removed.push(x.file); drawPhotos(); }
    if (e.target.closest("#pf-logo-rm")) { st.logo = null; st.logoRemoved = true; drawLogo(); }
  };
  root.onchange = async (e) => {
    if (e.target.id === "pf-uselogo") { st.useLogoColors = e.target.checked; $("#pf-colors").hidden = st.useLogoColors; }
    if (e.target.id === "pf-logo" && e.target.files[0]) {
      try { st.logo = await downscale(e.target.files[0], 800, 0.92, e.target.files[0].type === "image/jpeg" ? "image/jpeg" : "image/png"); st.logoRemoved = false; drawLogo(); } catch (_) { /* not an image */ }
      e.target.value = "";
    }
    if (e.target.id === "pf-addph") {
      for (const f of [...e.target.files]) {
        if (st.photos.length >= maxPhotos) break;
        try { st.photos.push({ data: await downscale(f, 1600, 0.84) }); } catch (_) { /* skip */ }
      }
      e.target.value = ""; drawPhotos();
    }
  };
  function collectSvcs() {
    root.querySelectorAll(".pf-svc").forEach((row) => {
      const s = st.services[Number(row.dataset.i)]; if (!s) return;
      row.querySelectorAll("[data-k]").forEach((i) => { s[i.dataset.k] = i.value.trim(); });
    });
  }
  const val = (id) => $(`#${id}`)?.value.trim();
  return {
    collect() {
      collectSvcs();
      const profile = {};
      const set = (k, id) => { const x = val(id); if (x !== undefined) profile[k] = x; };
      set("tagline", "pf-tagline"); set("usps", "pf-usps"); set("story", "pf-story"); set("since", "pf-since");
      set("address", "pf-address"); set("bookingUrl", "pf-booking"); set("menuUrl", "pf-menu"); set("payment", "pf-payment"); set("extras", "pf-extras");
      if (sections.includes("brand")) { profile.examples = (val("pf-examples") ?? "").split(/\s*\n\s*/).filter(Boolean).slice(0, 3); if (st.style) profile.style = st.style; profile.colors = st.useLogoColors ? { primary: "", accent: "" } : { primary: val("pf-primary"), accent: val("pf-accent") }; }
      if (sections.includes("offer")) profile.services = st.services.filter((s) => s.name);
      if (sections.includes("place")) { profile.social = {}; root.querySelectorAll("[data-social]").forEach((i) => { profile.social[i.dataset.social] = i.value.trim(); }); }
      const out = { profile };
      if (val("pf-offer") !== undefined) out.offer = val("pf-offer");
      if (val("pf-hours") !== undefined) out.hours = val("pf-hours");
      if (st.logo) out.logo = st.logo;
      if (st.logoRemoved && !st.logo) out.removeLogo = true;
      out.photos = st.photos.filter((x) => x.data).map((x) => x.data);
      out.removePhotos = st.removed;
      return out;
    },
    problem(section) {
      if (section === "offer" && requireOffer && !val("pf-offer")) return { id: "pf-offer", msg: st.lang === "es" ? "Cuéntanos qué ofreces." : "Tell us what you offer." };
      return null;
    },
    setLang(l) {
      const data = this.collect();
      const profile = { ...p, ...data.profile, style: st.style, colors: st.useLogoColors ? {} : data.profile.colors };
      return mount(root, { lang: l, sections, maxPhotos, requireOffer, values: { ...values, profile, offer: data.offer ?? values.offer, hours: data.hours ?? values.hours,
        logoData: st.logo, logoRemoved: st.logoRemoved, photoItems: st.photos, removed: st.removed } });
    },
  };
}

window.ProfileForm = { mount, downscale };
})();
