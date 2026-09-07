import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  build: {
    // The largest chunk is now vendor-charts at ~320 kB, comfortably under the
    // 500 kB default, so the limit is back to stock and a regression will trip it.
    rollupOptions: {
      output: {
        // Split the heavy vendors out of the app chunk. They change far less
        // often than our code, so they stay cached across deploys and the
        // browser can fetch them in parallel instead of as one blob.
        //
        // Matched by path, not package name: naming "react" only captures the
        // entry shim, leaving the implementation in whichever chunk pulled it.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](recharts|d3-|victory-|decimal\.js)/.test(id)) return "vendor-charts";
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|use-sync-external-store)[\\/]/.test(id)) return "vendor-react";
          return "vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
    open: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
