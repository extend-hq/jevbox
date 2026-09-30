import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: "es" },
  optimizeDeps: {
    entries: ["index.html"],
    include: [
      "react-dom/server",
      "@extend-ai/react-docx > react-dom/server",
      "@extend-ai/react-docx > utif",
      "@extend-ai/react-xlsx > regl",
      "@extend-ai/react-xlsx > topojson-client",
    ],
    exclude: [
      "@extend-ai/react-docx",
      "@extend-ai/react-pptx",
      "@extend-ai/react-xlsx",
    ],
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { allowedHosts: ["localhost", "127.0.0.1"] },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: ["index.html", "thumbnail-renderer.html"] },
  },
});
