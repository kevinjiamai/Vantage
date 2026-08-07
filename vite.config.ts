import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  build: {
    // vendor-firebase is ~575 kB (auth + firestore) and is the only chunk over
    // the 500 kB default. Deferring firestore behind a dynamic import would fix
    // it, but that sits on the auth path — worth doing deliberately, not as a
    // side effect of a size warning. Raised so a real regression still trips it.
    chunkSizeWarningLimit: 600,
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
          if (/[\\/]node_modules[\\/](@firebase|firebase|idb)[\\/]/.test(id)) return "vendor-firebase";
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
