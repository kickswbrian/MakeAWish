import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const api = process.env.API_URL ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    fs: { allow: [path.resolve(__dirname, "..")] },
    proxy: {
      "/api": api,
      "/models": api,
      "/socket.io": { target: api, ws: true },
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 2000,
  },
});
