import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror the tsconfig `"@/*": ["./*"]` path mapping. Without it, any test
    // that imports a module using the `@/` alias (e.g. proxy.ts) fails to
    // resolve, which keeps the middleware — where the CSP and framing headers
    // live — out of reach of the unit suite.
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
