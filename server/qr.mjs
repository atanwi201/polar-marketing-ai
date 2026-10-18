// QR codes for a client's website: an SVG to show in the dashboard and a large PNG to print.
import QRCode from "qrcode";

const base = { errorCorrectionLevel: "M", margin: 2 };
export const qrSvg = (text) => QRCode.toString(text, { ...base, type: "svg", color: { dark: "#111111", light: "#ffffff" } });
export const qrPng = (text, width = 1024) => QRCode.toBuffer(text, { ...base, type: "png", width, color: { dark: "#111111", light: "#ffffff" } });
