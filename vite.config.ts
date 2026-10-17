import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  // The local API (server/index.mjs) routes AI calls to OpenRouter free models.
  server: {
    proxy: Object.fromEntries(["/api", "/media", "/sites", "/portal", "/signup"].map((p) => [p, `http://localhost:${process.env.PORT ?? 8787}`])),
  },
});
