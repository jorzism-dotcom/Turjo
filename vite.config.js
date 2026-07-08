import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  build: {
    outDir: "dist",
    sourcemap: false,
    // Terser-level minification — smaller APK
    minify: "esbuild",
    // Chunk size warning threshold
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Manual chunks — Firebase আলাদা, vendor আলাদা (better caching)
        manualChunks(id) {
          if (id.includes("firebase")) return "firebase";
          if (id.includes("zustand")) return "vendor";
          if (id.includes("react-virtuoso")) return "vendor";
          if (id.includes("node_modules")) return "vendor";
        },
      },
    },
  },
  // Worker optimization
  worker: {
    format: "es",
  },
});
