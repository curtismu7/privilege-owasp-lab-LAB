import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the API runs on PORT (7811, npm start) and Vite on VITE_PORT. /api is proxied, so the browser only ever talks to one
// origin (same-origin writes and runs). Vite picks a free port if VITE_PORT is busy; it is dev-only, never published.
const api = { target: `http://127.0.0.1:${Number(process.env.PORT) || 7811}` };

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: Number(process.env.VITE_PORT) || 5180, strictPort: false, proxy: { "/api": api } },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/testSetup.js" },
});
