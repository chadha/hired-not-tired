// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// Never set ssr.external or resolve.external: the Worker has no runtime module resolution, so
// the build fails. Never add compression (compressPublicAssets, vite-plugin-compression):
// hosting already compresses at the edge.
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // Pre-bundle UI deps so a first visit doesn't trigger a mid-session re-optimize (duplicate React copies).
  vite: {
    server: {
      proxy: {
        "/local-api": {
          target: "http://127.0.0.1:8019",
          changeOrigin: false,
          bypass(req) {
            if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "")) {
              return false;
            }
          },
        },
      },
    },
    optimizeDeps: {
      include: ["@radix-ui/react-slot", "@radix-ui/react-label", "lucide-react", "framer-motion"],
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
