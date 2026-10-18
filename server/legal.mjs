// Privacy policy (RGPD/LOPDGDD) and legal notice (LSSI-CE) pages, ES/EN. Served at /privacy and /legal.
// Controller identity comes from env so nothing personal is hardcoded: LEGAL_NAME, LEGAL_NIF, LEGAL_ADDRESS.
import { OWNER_EMAIL } from "./declined.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const who = () => ({
  name: process.env.LEGAL_NAME || "Polar Marketing (titular pendiente de completar)",
  nif: process.env.LEGAL_NIF || "NIF pendiente de completar",
  address: process.env.LEGAL_ADDRESS || "Santa Cruz de Tenerife, Islas Canarias, España",
});

const T = {
  privacy: {
    es: (w) => ({ title: "Política de privacidad", body: `
<p>Última actualización: octubre de 2026.</p>
<h2>Quién es el responsable</h2>
<p><b>${esc(w.name)}</b> (${esc(w.nif)}), ${esc(w.address)}. Contacto: <a href="mailto:${OWNER_EMAIL}">${OWNER_EMAIL}</a>.</p>
<h2>Dos situaciones distintas</h2>
<p><b>1. Negocios que contratan Polar Marketing.</b> Somos responsables de los datos del negocio y de su persona de contacto (nombre, correo, teléfono, datos del negocio, fotos y textos que nos facilitan). Los usamos para prestar el servicio (base jurídica: ejecución del contrato) y, si lo marcas, para enviarte novedades (consentimiento).</p>
<p><b>2. Clientes finales de esos negocios</b> (programa de fidelidad, reservas). Aquí el responsable es el negocio con el que interactúas y Polar Marketing actúa como encargado del tratamiento, por cuenta suya. Los datos (nombre, correo, teléfono, visitas, reservas) se usan para gestionar tu tarjeta de fidelidad o tu reserva y, solo si lo marcas, para enviarte ofertas.</p>
<h2>Cuánto tiempo los conservamos</h2>
<p>Mientras dure la relación y, después, bloqueados durante los plazos legales de prescripción. Puedes pedir la supresión en cualquier momento.</p>
<h2>A quién los comunicamos</h2>
<p>No vendemos datos. Usamos proveedores que tratan datos por nuestra cuenta: alojamiento del servidor, envío de correo (Resend) y proveedores de IA para generar textos e imágenes (sin enviar datos de contacto de clientes finales). Algunos pueden estar fuera del Espacio Económico Europeo, con las garantías del RGPD (cláusulas contractuales tipo).</p>
<h2>Tus derechos</h2>
<p>Acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a <a href="mailto:${OWNER_EMAIL}">${OWNER_EMAIL}</a>. Puedes retirar el consentimiento de marketing cuando quieras y reclamar ante la Agencia Española de Protección de Datos (<a href="https://www.aepd.es">aepd.es</a>).</p>
<h2>Cookies</h2>
<p>Solo usamos una cookie técnica de sesión para el acceso al panel (necesaria, no requiere consentimiento). No usamos cookies de publicidad ni de analítica.</p>` }),
    en: (w) => ({ title: "Privacy policy", body: `
<p>Last updated: October 2026.</p>
<h2>Who is responsible</h2>
<p><b>${esc(w.name)}</b> (${esc(w.nif)}), ${esc(w.address)}. Contact: <a href="mailto:${OWNER_EMAIL}">${OWNER_EMAIL}</a>.</p>
<h2>Two different situations</h2>
<p><b>1. Businesses that hire Polar Marketing.</b> We are the controller of the business and contact details (name, email, phone, business info, photos and texts you give us). We use them to provide the service (legal basis: contract) and, if you tick the box, to send you news (consent).</p>
<p><b>2. End customers of those businesses</b> (loyalty, bookings). The controller is the business you deal with; Polar Marketing acts as processor on its behalf. Your data (name, email, phone, visits, bookings) is used to run your loyalty card or booking and, only if you tick the box, to send you offers.</p>
<h2>How long we keep it</h2>
<p>For as long as the relationship lasts, then blocked for the legal limitation periods. You can ask for deletion at any time.</p>
<h2>Who receives it</h2>
<p>We do not sell data. Providers acting on our behalf: server hosting, email delivery (Resend) and AI providers used to generate texts and images (end-customer contact details are not sent to them). Some may be outside the EEA, under GDPR safeguards (standard contractual clauses).</p>
<h2>Your rights</h2>
<p>Access, rectification, erasure, objection, restriction and portability by writing to <a href="mailto:${OWNER_EMAIL}">${OWNER_EMAIL}</a>. You can withdraw marketing consent at any time and complain to the Spanish Data Protection Agency (<a href="https://www.aepd.es">aepd.es</a>).</p>
<h2>Cookies</h2>
<p>We only use one technical session cookie for dashboard login (strictly necessary, no consent needed). No advertising or analytics cookies.</p>` }),
  },
  legal: {
    es: (w) => ({ title: "Aviso legal", body: `
<p>En cumplimiento de la Ley 34/2002 (LSSI-CE):</p>
<ul><li>Titular: <b>${esc(w.name)}</b></li><li>NIF: ${esc(w.nif)}</li><li>Domicilio: ${esc(w.address)}</li><li>Correo: <a href="mailto:${OWNER_EMAIL}">${OWNER_EMAIL}</a></li></ul>
<h2>Condiciones de uso</h2>
<p>Polar Marketing presta servicios de marketing digital a negocios locales. El contenido generado con IA es revisado por el cliente antes de publicarse cuando así se configura. Los precios se indican sin IGIC salvo que se diga lo contrario.</p>
<h2>Comunicaciones comerciales</h2>
<p>Solo enviamos comunicaciones comerciales a quien las ha solicitado o ha dado su consentimiento, y siempre con una forma sencilla de darse de baja.</p>
<h2>Ley aplicable</h2>
<p>Legislación española. Más información sobre datos personales en la <a href="/privacy?l=es">política de privacidad</a>.</p>` }),
    en: (w) => ({ title: "Legal notice", body: `
<p>Under Spanish Law 34/2002 (LSSI-CE):</p>
<ul><li>Owner: <b>${esc(w.name)}</b></li><li>Tax ID: ${esc(w.nif)}</li><li>Address: ${esc(w.address)}</li><li>Email: <a href="mailto:${OWNER_EMAIL}">${OWNER_EMAIL}</a></li></ul>
<h2>Terms of use</h2>
<p>Polar Marketing provides digital marketing services to local businesses. AI-generated content is reviewed by the client before publishing when configured that way. Prices exclude IGIC unless stated otherwise.</p>
<h2>Commercial communications</h2>
<p>We only send commercial messages to people who asked for them or consented, always with an easy way to opt out.</p>
<h2>Governing law</h2>
<p>Spanish law. See the <a href="/privacy?l=en">privacy policy</a> for personal data.</p>` }),
  },
};

export function legalPage(kind, want) {
  const lang = want === "en" ? "en" : "es", other = lang === "es" ? "en" : "es";
  const { title, body } = T[kind][lang](who());
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Polar Marketing</title>
<style>:root{color-scheme:light dark}body{font:16px/1.6 system-ui,sans-serif;max-width:720px;margin:0 auto;padding:24px 16px 48px;background:Canvas;color:CanvasText}
h1{font-size:1.6rem}h2{font-size:1.1rem;margin-top:1.6em}a{color:#0b6bcb}.sw{float:right;font-size:.9rem}</style></head>
<body><a class="sw" href="?l=${other}">${other.toUpperCase()}</a><h1>${esc(title)}</h1>${body}</body></html>`;
}
