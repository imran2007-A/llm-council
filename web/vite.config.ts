import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The API runs on 8000. Proxying /api in dev means the frontend uses same-origin
// relative URLs everywhere, so the production build (served by FastAPI itself)
// needs no different configuration.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../static_web",
    emptyOutDir: true,
  },
});
