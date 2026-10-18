import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

const api = `http://localhost:${process.env.PORT ?? 8787}`;

export default defineConfig(({ command }) => ({
  plugins: [react(), viteSingleFile()],
  // In dev the admin app lives at /admin/ like in production; everything else (the landing page at /,
  // the client portal, sign-up, sites and the API) comes from the local server (server/index.mjs).
  base: command === "serve" ? "/admin/" : "/",
  server: {
    proxy: Object.fromEntries(["^/$", "^/login$", "/api", "/media", "/sites", "/portal", "/signup", "/puter-callback", "/p/", "/assets/profile-form.js"].map((p) => [p, api])),
  },
}));
