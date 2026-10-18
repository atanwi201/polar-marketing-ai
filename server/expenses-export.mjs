// Month exports of the expense tracker: CSV and OpenDocument Spreadsheet (.ods, opens in LibreOffice, Excel and Numbers).
import { zipSync, strToU8 } from "fflate";
import { CATEGORIES } from "./expenses.mjs";

const LABELS = {
  es: { sheet: "Gastos", date: "Fecha", store: "Comercio", location: "Local", category: "Categoría", items: "Artículos", tax: "Impuesto (IGIC/IVA)", total: "Total", notes: "Notas", sum: "Total",
    cat: { food: "Comida", supplies: "Suministros", utilities: "Suministros básicos", rent: "Alquiler", transport: "Transporte", marketing: "Marketing", equipment: "Equipamiento", services: "Servicios", other: "Otros" } },
  en: { sheet: "Expenses", date: "Date", store: "Store", location: "Location", category: "Category", items: "Items", tax: "Tax (IGIC/VAT)", total: "Total", notes: "Notes", sum: "Total",
    cat: { food: "Food", supplies: "Supplies", utilities: "Utilities", rent: "Rent", transport: "Transport", marketing: "Marketing", equipment: "Equipment", services: "Services", other: "Other" } },
};
export const labels = (lang) => LABELS[lang === "en" ? "en" : "es"];

const money = (c) => (c === null || c === undefined ? null : c / 100);
const itemsText = (x) => x.items.map((i) => `${i.qty !== 1 ? i.qty + "× " : ""}${i.name}`).join("; ");

/** Rows (header first) shared by both formats. Numbers stay numbers. */
export function rows(items, cfg, lang) {
  const L = labels(lang), loc = Object.fromEntries(cfg.locations.map((l) => [l.id, l.name]));
  const out = [[L.date, L.store, L.location, L.category, L.items, L.tax, L.total, L.notes]];
  for (const x of [...items].sort((a, b) => a.date.localeCompare(b.date))) {
    out.push([x.date, x.store, loc[x.locationId] ?? "", L.cat[x.category] ?? x.category, itemsText(x), money(x.taxCents), money(x.totalCents), x.notes]);
  }
  return out;
}

/** A leading = + - @ in text would run as a formula in Excel/Sheets: prefix it. */
const safeText = (s) => (/^[=+\-@\t\r]/.test(s) ? "'" + s : s);

export function toCsv(items, cfg, lang = "es") {
  const cell = (v) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? v.toFixed(2) : safeText(String(v));
    return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows(items, cfg, lang).map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

export function toOds(items, cfg, lang = "es", title = "") {
  const L = labels(lang), data = rows(items, cfg, lang), cur = cfg.currency;
  const cell = (v, head) => {
    if (typeof v === "number") return `<table:table-cell office:value-type="currency" office:currency="${cur}" office:value="${v.toFixed(2)}" table:style-name="money"><text:p>${v.toFixed(2)}</text:p></table:table-cell>`;
    if (v === null || v === undefined || v === "") return "<table:table-cell/>";
    return `<table:table-cell office:value-type="string"${head ? ' table:style-name="head"' : ""}><text:p>${xml(v)}</text:p></table:table-cell>`;
  };
  const body = data.map((r, i) => `<table:table-row>${r.map((v) => cell(v, i === 0)).join("")}</table:table-row>`).join("");
  const sum = items.reduce((a, x) => a + x.totalCents, 0) / 100;
  const totalRow = `<table:table-row><table:table-cell office:value-type="string" table:style-name="head"><text:p>${xml(L.sum)}</text:p></table:table-cell><table:table-cell table:number-columns-repeated="5"/><table:table-cell office:value-type="currency" office:currency="${cur}" office:value="${sum.toFixed(2)}" table:style-name="money"><text:p>${sum.toFixed(2)}</text:p></table:table-cell></table:table-row>`;
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2">
<office:automatic-styles>
<style:style style:name="head" style:family="table-cell"><style:table-cell-properties fo:background-color="#e6f7a8"/><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="money" style:family="table-cell"/>
</office:automatic-styles>
<office:body><office:spreadsheet><table:table table:name="${xml((title || L.sheet).replace(/[\[\]*?:\/\\]/g, "-").slice(0, 31))}">
<table:table-column table:number-columns-repeated="8"/>
${body}${totalRow}
</table:table></office:spreadsheet></office:body></office:document-content>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;
  // The mimetype entry must be first and stored (not compressed).
  return Buffer.from(zipSync({
    mimetype: [strToU8("application/vnd.oasis.opendocument.spreadsheet"), { level: 0 }],
    "content.xml": strToU8(content),
    "META-INF/manifest.xml": strToU8(manifest),
  }));
}
export { CATEGORIES };
