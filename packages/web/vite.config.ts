import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 7332,
    proxy: {
      "/api": {
        target: "http://localhost:7334",
        changeOrigin: true,
        // Disable buffering for SSE streams (index progress)
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            // Tell proxy not to buffer the response
            if (req.url?.includes("/connectors/index")) {
              proxyReq.setHeader("X-Accel-Buffering", "no");
            }
          });
          proxy.on("proxyRes", (proxyRes) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              // Disable response buffering for SSE
              proxyRes.headers["cache-control"] = "no-cache";
              proxyRes.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
    },
  },
});
