import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Unit tests execute server modules in Node; use the package's react-server empty export.
  // The real Next build enforces the server-only client-import prohibition.
  resolve: { alias: { "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)) } },
  test: { include: ["tests/**/*.test.ts"], maxWorkers: 1 },
});
