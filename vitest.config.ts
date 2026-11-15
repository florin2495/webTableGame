import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Only the "@/" alias of tsconfig.json, so tests of server modules (src/lib/server/*.test.ts) resolve their imports.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
