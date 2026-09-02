import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const assetVersion = "20260902-2";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "asset-cache-version",
      transformIndexHtml(html) {
        return html
          .replace("assets/app.js", `assets/app.js?v=${assetVersion}`)
          .replace("assets/styles.css", `assets/styles.css?v=${assetVersion}`);
      },
    },
  ],
  base: "/barrierefreie-wohnungen-dresden/",
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith(".css")
            ? "assets/styles.css"
            : "assets/[name][extname]",
      },
    },
  },
});
