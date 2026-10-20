// Privacy policy (RGPD/LOPDGDD) and legal notice (LSSI-CE) pages, ES/EN. Served at /privacy and /legal.
// Controller identity comes from env so nothing personal is hardcoded:
// LEGAL_NAME, LEGAL_NIF, LEGAL_ADDRESS, LEGAL_EMAIL, LEGAL_PHONE (see .env.example).
// Anything marked [PENDIENTE ...] / [PENDING ...] needs the controller's own input before launch (see docs/privacy/).

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const env = (k) => String(process.env[k] ?? "").trim();

/** True on a real deployment: NODE_ENV=production (the deploy must set it). */
export const isProduction = () => env("NODE_ENV") === "production";

/** Controller identity from env. `missing` lists the LEGAL_* variables that are still empty. */
export function legalIdentity() {
  const id = { name: env("LEGAL_NAME"), nif: env("LEGAL_NIF"), address: env("LEGAL_ADDRESS"), email: env("LEGAL_EMAIL"), phone: env("LEGAL_PHONE") };
  const missing = [["LEGAL_NAME", id.name], ["LEGAL_NIF", id.nif], ["LEGAL_ADDRESS", id.address], ["LEGAL_EMAIL", id.email]].filter(([, v]) => !v).map(([k]) => k);
  return { ...id, missing, complete: missing.length === 0 };
}

/** Public contact address for data-protection and support requests. Empty in production until LEGAL_EMAIL is set.
 *  Outside production only, a development fallback keeps local pages and tests usable. */
export const DEV_CONTACT_FALLBACK = "atanwi85@gmail.com"; // development only; never used in production
export const contactEmail = () => env("LEGAL_EMAIL") || (isProduction() ? "" : DEV_CONTACT_FALLBACK);

const who = () => {
  const i = legalIdentity();
  const p = (v, es, en) => ({ es: v || `[PENDIENTE: ${es}]`, en: v || `[PENDING: ${en}]` });
  return { ...i, v: { name: p(i.name, "nombre o denominación del titular", "owner name"), nif: p(i.nif, "NIF", "tax ID"), address: p(i.address, "domicilio", "address"), email: p(i.email, "correo de contacto", "contact email"), phone: p(i.phone, "teléfono (opcional)", "phone (optional)") } };
};
const mail = (w, l) => (w.email ? `<a href="mailto:${esc(w.email)}">${esc(w.email)}</a>` : esc(w.v.email[l]));
const ctrl = (w, l) => `<b>${esc(w.v.name[l])}</b> (${esc(w.v.nif[l])}), ${esc(w.v.address[l])}`;

const SUBS = [
  // name, es purpose, en purpose, location, safeguard
  ["Resend (Resend, Inc.)", "Envío de correos transaccionales (reservas)", "Transactional email delivery (bookings)", "EE. UU.", "US", "Data Privacy Framework / cláusulas contractuales tipo", "Data Privacy Framework / standard contractual clauses"],
  ["Proveedor de alojamiento VPS [PENDIENTE: nombre y país]", "Alojamiento del servidor y copias de seguridad", "Server hosting and backups", "[PENDIENTE]", "[PENDING]", "[PENDIENTE: ubicación UE/EEE o garantías]", "[PENDING: EU/EEA location or safeguards]"],
  ["OpenRouter", "Generación de textos con IA (puede enrutar a terceros modelos)", "AI text generation (may route to third-party models)", "EE. UU.", "US", "Cláusulas contractuales tipo / DPF (según proveedor final)", "Standard contractual clauses / DPF (depends on final model provider)"],
  ["Google (Gemini API)", "IA de texto e imagen, lectura de tickets", "AI text/image, receipt reading", "EE. UU. / UE", "US / EU", "Data Privacy Framework / cláusulas contractuales tipo", "Data Privacy Framework / standard contractual clauses"],
  ["Groq", "IA de texto y visión", "AI text and vision", "EE. UU.", "US", "Cláusulas contractuales tipo [PENDIENTE: verificar]", "Standard contractual clauses [PENDING: verify]"],
  ["Mistral AI", "IA de texto y visión", "AI text and vision", "UE (Francia)", "EU (France)", "Dentro del EEE", "Inside the EEA"],
  ["SiliconFlow", "IA de texto e imagen (modelos de terceros)", "AI text and image (third-party models)", "China / otros", "China / other", "Sin decisión de adecuación: solo contenido no personal; cláusulas contractuales tipo y evaluación de transferencia [PENDIENTE]", "No adequacy decision: non-personal content only; standard contractual clauses and transfer assessment [PENDING]"],
  ["Puter", "IA de texto e imagen", "AI text and image", "EE. UU.", "US", "Cláusulas contractuales tipo [PENDIENTE: verificar]", "Standard contractual clauses [PENDING: verify]"],
  ["TokenHarbor", "IA de texto (contenido del negocio)", "AI text (business content)", "[PENDIENTE: verificar]", "[PENDING: verify]", "Cláusulas contractuales tipo [PENDIENTE: verificar]", "Standard contractual clauses [PENDING: verify]"],
  ["Pollinations", "Generación de imágenes (el texto de la petición viaja en la URL)", "Image generation (the prompt travels in the URL)", "[PENDIENTE: verificar]", "[PENDING: verify]", "Solo descripciones no personales de imágenes", "Non-personal image descriptions only"],
  ["Meta, X, YouTube/Google", "Publicación en las redes del negocio, a petición suya", "Publishing to the business's own networks, at its request", "EE. UU.", "US", "Data Privacy Framework / cláusulas contractuales tipo", "Data Privacy Framework / standard contractual clauses"],
  ["Google Wallet / Apple Wallet", "Tarjeta de fidelidad en el móvil, solo si la persona la añade", "Loyalty card on the phone, only if the person adds it", "EE. UU.", "US", "Iniciado por la persona usuaria; DPF / cláusulas contractuales tipo", "Initiated by the user; DPF / standard contractual clauses"],
];
const subTable = (l) => `<table><thead><tr><th>${l === "es" ? "Proveedor" : "Provider"}</th><th>${l === "es" ? "Finalidad" : "Purpose"}</th><th>${l === "es" ? "País" : "Country"}</th><th>${l === "es" ? "Garantía de transferencia" : "Transfer safeguard"}</th></tr></thead><tbody>${SUBS.map((s) => `<tr><td>${esc(s[0])}</td><td>${esc(l === "es" ? s[1] : s[2])}</td><td>${esc(l === "es" ? s[3] : s[4])}</td><td>${esc(l === "es" ? s[5] : s[6])}</td></tr>`).join("")}</tbody></table>`;

const T = {
  privacy: {
    es: (w) => ({ title: "Política de privacidad", body: `
<p>Versión 2026-10 · Última actualización: octubre de 2026.</p>
<h2>1. Responsable e identidad</h2>
<p>${ctrl(w, "es")}. Correo: ${mail(w, "es")}${w.phone ? `. Teléfono: ${esc(w.phone)}` : ""}. Delegado de protección de datos: no designado (no obligatorio por ahora) [PENDIENTE: confirmar].</p>
<h2>2. Dos situaciones distintas</h2>
<p><b>A. Negocios que contratan Polar Marketing.</b> Somos responsables de los datos del negocio y de su persona de contacto (nombre, correo, teléfono, datos y fotos del negocio, textos que nos facilitan, aceptación de condiciones con fecha).</p>
<p><b>B. Clientes finales de esos negocios</b> (tarjeta de fidelidad, reservas, carta digital, gastos). El responsable es el negocio con el que interactúas; Polar Marketing actúa como <b>encargado del tratamiento</b>, por cuenta suya y con un contrato conforme al art. 28 RGPD. Para ejercer tus derechos sobre estos datos, dirígete primero al negocio; también podemos reenviarle tu solicitud si nos escribes.</p>
<h2>3. Finalidades y bases jurídicas</h2>
<table><thead><tr><th>Finalidad</th><th>Datos</th><th>Base jurídica</th></tr></thead><tbody>
<tr><td>Alta, gestión y soporte de la cuenta del negocio</td><td>Contacto, datos del negocio, contenidos</td><td>Ejecución del contrato (art. 6.1.b)</td></tr>
<tr><td>Facturación y obligaciones fiscales/contables</td><td>Datos de facturación</td><td>Obligación legal (art. 6.1.c)</td></tr>
<tr><td>Novedades comerciales a negocios (opcional)</td><td>Correo, nombre</td><td>Consentimiento (art. 6.1.a), revocable</td></tr>
<tr><td>Reservas: gestionar y confirmar tu reserva, avisar al negocio</td><td>Nombre, correo, teléfono, fecha, notas</td><td>Medidas precontractuales/contrato con el negocio (art. 6.1.b)</td></tr>
<tr><td>Fidelidad: tarjeta, visitas, premios</td><td>Nombre, correo/teléfono, visitas, canjes</td><td>Contrato con el negocio; ofertas solo con consentimiento</td></tr>
<tr><td>Generación de contenido con IA para el negocio</td><td>Datos y fotos del negocio</td><td>Ejecución del contrato</td></tr>
<tr><td>Seguridad, prevención de abuso y registros técnicos</td><td>IP, registros de acceso</td><td>Interés legítimo (art. 6.1.f)</td></tr></tbody></table>
<p>No tomamos decisiones automatizadas con efectos jurídicos sobre ti. La IA se usa para redactar contenido del negocio, siempre con revisión del negocio cuando así se configura.</p>
<h2>4. Origen de los datos</h2>
<p>Los facilita directamente la persona interesada o el negocio que nos contrata.</p>
<h2>5. Plazos de conservación</h2>
<p>Cuenta del negocio: mientras dure el contrato y, después, bloqueados durante los plazos de prescripción legal (facturas y libros: 6 años; tributos: 4 años). Reservas: [PENDIENTE: confirmar, propuesta 24 meses desde la fecha de la reserva]. Fidelidad: mientras el programa esté activo y [PENDIENTE: propuesta 24 meses] desde la última actividad. Tickets de gastos: según la normativa contable del negocio. Registros técnicos: hasta [PENDIENTE: propuesta 90 días]. Detalle en la documentación interna de retención.</p>
<h2>6. Destinatarios y encargados (sub-encargados)</h2>
<p>No vendemos datos. Recurrimos a los proveedores siguientes, que tratan datos por cuenta nuestra o del negocio:</p>
${subTable("es")}
<p>Las transferencias fuera del EEE se amparan en decisión de adecuación (Marco de Privacidad de Datos UE-EE. UU. cuando el proveedor está certificado) o cláusulas contractuales tipo. En China no existe decisión de adecuación: a esos proveedores solo se envía contenido sin datos personales de clientes finales. Datos de contacto de clientes finales no se envían a proveedores de IA; las fotos de tickets de gastos sí pueden enviarse a un proveedor de visión y pueden contener datos personales, por lo que el negocio debe evitar subir tickets con datos de terceros.</p>
<p>Si añades tu tarjeta a Google Wallet o Apple Wallet, tu nombre y el código de la tarjeta se comparten con ese proveedor por decisión tuya.</p>
<h2>7. Tus derechos</h2>
<p>Acceso, rectificación, supresión, oposición, limitación y portabilidad, escribiendo a ${mail(w, "es")}. Puedes retirar el consentimiento en cualquier momento sin efecto retroactivo. Si no estás conforme, puedes reclamar ante la Agencia Española de Protección de Datos (<a href="https://www.aepd.es">aepd.es</a>). Respondemos en el plazo de un mes.</p>
<h2>8. Menores</h2>
<p>El servicio no se dirige a menores de 14 años y no recogemos sus datos a sabiendas.</p>
<h2>9. Seguridad y brechas</h2>
<p>Aplicamos medidas técnicas y organizativas razonables (acceso con credenciales, enlaces con fichas aleatorias, límites de uso). Si ocurre una brecha que afecte a datos personales, la notificaremos a la AEPD en un máximo de 72 horas cuando haya riesgo y avisaremos a las personas afectadas (y a los negocios responsables, si somos encargados) sin dilación indebida cuando el riesgo sea alto.</p>
<h2>10. Cookies y recursos de terceros</h2>
<p>Solo usamos una cookie técnica de sesión para el acceso al panel (estrictamente necesaria). No usamos cookies de publicidad ni de analítica. Las páginas de Polar Marketing (inicio, alta, reservas, tarjeta, carta, privacidad) no cargan fuentes ni scripts de terceros. Las páginas web generadas para cada negocio pueden cargar recursos estáticos (por ejemplo Bootstrap) desde una red de distribución de contenidos (jsDelivr), lo que implica que tu IP llegue a ese proveedor al visitar esas páginas; ese negocio es el responsable de esa web. [PENDIENTE: eliminar esta frase cuando los sitios se sirvan sin CDN.]</p>` }),
    en: (w) => ({ title: "Privacy policy", body: `
<p>Version 2026-10 · Last updated: October 2026.</p>
<h2>1. Controller and identity</h2>
<p>${ctrl(w, "en")}. Email: ${mail(w, "en")}${w.phone ? `. Phone: ${esc(w.phone)}` : ""}. Data protection officer: not appointed (not currently required) [PENDING: confirm].</p>
<h2>2. Two different situations</h2>
<p><b>A. Businesses that hire Polar Marketing.</b> We are the controller of the business and contact details (name, email, phone, business info and photos, texts you give us, dated acceptance of terms).</p>
<p><b>B. End customers of those businesses</b> (loyalty card, bookings, digital menu, expenses). The controller is the business you deal with; Polar Marketing acts as <b>processor</b> on its behalf under an Art. 28 GDPR agreement. To exercise your rights over this data, contact the business first; if you write to us we can forward your request to it.</p>
<h2>3. Purposes and legal bases</h2>
<table><thead><tr><th>Purpose</th><th>Data</th><th>Legal basis</th></tr></thead><tbody>
<tr><td>Business account set-up, management and support</td><td>Contact, business data, content</td><td>Contract (Art. 6.1.b)</td></tr>
<tr><td>Invoicing and tax/accounting duties</td><td>Billing data</td><td>Legal obligation (Art. 6.1.c)</td></tr>
<tr><td>News to businesses (optional)</td><td>Email, name</td><td>Consent (Art. 6.1.a), revocable</td></tr>
<tr><td>Bookings: manage and confirm your booking, notify the business</td><td>Name, email, phone, date, notes</td><td>Pre-contractual steps / contract with the business (Art. 6.1.b)</td></tr>
<tr><td>Loyalty: card, visits, rewards</td><td>Name, email/phone, visits, redemptions</td><td>Contract with the business; offers only with consent</td></tr>
<tr><td>AI-generated content for the business</td><td>Business data and photos</td><td>Contract</td></tr>
<tr><td>Security, abuse prevention, technical logs</td><td>IP, access logs</td><td>Legitimate interest (Art. 6.1.f)</td></tr></tbody></table>
<p>We take no automated decisions with legal effects on you. AI is used to draft business content, reviewed by the business when configured that way.</p>
<h2>4. Source of data</h2>
<p>Provided by the data subject or by the business that hires us.</p>
<h2>5. Retention</h2>
<p>Business account: for the contract term, then blocked for legal limitation periods (invoices and books: 6 years; taxes: 4 years). Bookings: [PENDING: confirm, proposed 24 months from the booking date]. Loyalty: while the programme is active plus [PENDING: proposed 24 months] since last activity. Expense receipts: per the business's accounting rules. Technical logs: up to [PENDING: proposed 90 days]. Details in the internal retention schedule.</p>
<h2>6. Recipients and sub-processors</h2>
<p>We do not sell data. We use the following providers, acting on behalf of us or of the business:</p>
${subTable("en")}
<p>Transfers outside the EEA rely on an adequacy decision (EU-US Data Privacy Framework where the provider is certified) or standard contractual clauses. There is no adequacy decision for China: only content without end-customer personal data is sent to those providers. End-customer contact details are not sent to AI providers; photos of expense receipts may be sent to a vision provider and may contain personal data, so businesses should avoid uploading receipts showing third-party data.</p>
<p>If you add your card to Google Wallet or Apple Wallet, your name and card code are shared with that provider at your choice.</p>
<h2>7. Your rights</h2>
<p>Access, rectification, erasure, objection, restriction and portability by writing to ${mail(w, "en")}. You can withdraw consent at any time without retroactive effect. You may complain to the Spanish Data Protection Agency (<a href="https://www.aepd.es">aepd.es</a>). We answer within one month.</p>
<h2>8. Children</h2>
<p>The service is not aimed at under-14s and we do not knowingly collect their data.</p>
<h2>9. Security and breaches</h2>
<p>We apply reasonable technical and organisational measures (credentialed access, random-token links, rate limits). If a personal data breach occurs we will notify the AEPD within 72 hours where there is a risk, and notify affected people (and the controlling businesses, where we are processor) without undue delay when the risk is high.</p>
<h2>10. Cookies and third-party resources</h2>
<p>We only use one technical session cookie for dashboard login (strictly necessary). No advertising or analytics cookies. Polar Marketing's own pages (home, sign-up, bookings, card, menu, privacy) load no third-party fonts or scripts. Websites generated for each business may load static assets (for example Bootstrap) from a content delivery network (jsDelivr), which means your IP reaches that provider when you visit those pages; that business is responsible for its site. [PENDING: remove this sentence once sites are served without a CDN.]</p>` }),
  },
  legal: {
    es: (w) => ({ title: "Aviso legal", body: `
<p>En cumplimiento del art. 10 de la Ley 34/2002 (LSSI-CE):</p>
<ul><li>Titular: <b>${esc(w.v.name.es)}</b></li><li>NIF: ${esc(w.v.nif.es)}</li><li>Domicilio: ${esc(w.v.address.es)}</li><li>Correo: ${mail(w, "es")}</li>${w.phone ? `<li>Teléfono: ${esc(w.phone)}</li>` : ""}<li>Datos registrales (si aplica): [PENDIENTE: Registro Mercantil, tomo, folio, hoja]</li></ul>
<h2>Condiciones de uso</h2>
<p>Polar Marketing presta servicios de marketing digital a negocios locales. El contenido generado con IA es revisado por el cliente antes de publicarse cuando así se configura. Los precios se indican sin IGIC salvo que se diga lo contrario. [PENDIENTE: condiciones contractuales completas y versión aceptada.]</p>
<h2>Encargo de tratamiento</h2>
<p>Los negocios que usan fidelidad, reservas, carta o gastos son responsables de los datos de sus clientes; Polar Marketing es su encargado del tratamiento. Contrato de encargo disponible en la documentación de privacidad.</p>
<h2>Comunicaciones comerciales</h2>
<p>Solo enviamos comunicaciones comerciales a quien las ha solicitado o ha dado su consentimiento, y siempre con una forma sencilla de darse de baja. Los correos de reserva son mensajes de servicio, no publicidad.</p>
<h2>Ley aplicable</h2>
<p>Legislación española. Más información sobre datos personales en la <a href="/privacy?l=es">política de privacidad</a>.</p>` }),
    en: (w) => ({ title: "Legal notice", body: `
<p>Under Art. 10 of Spanish Law 34/2002 (LSSI-CE):</p>
<ul><li>Owner: <b>${esc(w.v.name.en)}</b></li><li>Tax ID: ${esc(w.v.nif.en)}</li><li>Address: ${esc(w.v.address.en)}</li><li>Email: ${mail(w, "en")}</li>${w.phone ? `<li>Phone: ${esc(w.phone)}</li>` : ""}<li>Registry data (if applicable): [PENDING: commercial registry, volume, folio, sheet]</li></ul>
<h2>Terms of use</h2>
<p>Polar Marketing provides digital marketing services to local businesses. AI-generated content is reviewed by the client before publishing when configured that way. Prices exclude IGIC unless stated otherwise. [PENDING: full contract terms and accepted version.]</p>
<h2>Data processing</h2>
<p>Businesses using loyalty, bookings, menu or expenses are controllers of their customers' data; Polar Marketing is their processor. The processing agreement is available in the privacy documentation.</p>
<h2>Commercial communications</h2>
<p>We only send commercial messages to people who asked for them or consented, always with an easy way to opt out. Booking emails are service messages, not advertising.</p>
<h2>Governing law</h2>
<p>Spanish law. See the <a href="/privacy?l=en">privacy policy</a> for personal data.</p>` }),
  },
};

export function legalPage(kind, want) {
  const lang = want === "en" ? "en" : "es", other = lang === "es" ? "en" : "es";
  const w = who();
  const { title, body } = T[kind][lang](w);
  const warn = !isProduction() && !w.complete
    ? `<div role="alert" style="border:2px solid #b42318;background:#fef3f2;color:#7a271a;padding:12px 14px;border-radius:8px;margin:0 0 16px"><b>${lang === "es" ? "Borrador no válido para publicar" : "Draft, not valid for publishing"}</b>: ${lang === "es" ? "faltan datos del titular. Define en el entorno" : "controller details are missing. Set in the environment"} ${esc(w.missing.join(", "))}.</div>`
    : "";
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Polar Marketing</title>
<style>:root{color-scheme:light dark}body{font:16px/1.6 system-ui,sans-serif;max-width:720px;margin:0 auto;padding:24px 16px 48px;background:Canvas;color:CanvasText}
h1{font-size:1.6rem}h2{font-size:1.1rem;margin-top:1.6em}a{color:#0b6bcb}.sw{float:right;font-size:.9rem}
table{border-collapse:collapse;width:100%;font-size:.85rem;display:block;overflow-x:auto}th,td{border:1px solid #8884;padding:6px 8px;text-align:left;vertical-align:top}</style></head>
<body><a class="sw" href="?l=${other}">${other.toUpperCase()}</a><h1>${esc(title)}</h1>${warn}${body}</body></html>`;
}
