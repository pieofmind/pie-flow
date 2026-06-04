import { defineConfig } from "vitest/config";
import { resolve } from "path";

/**
 * Vitest config — aliases the runtime-only `obsidian` module to a local
 * stub so component unit tests can import from `obsidian` without
 * Vitest failing to resolve the real package (which only exists at
 * runtime inside Obsidian).
 *
 * Production builds use esbuild with `external: ["obsidian", ...]` so
 * the real Obsidian module is injected at runtime. The stub here is
 * for the test runtime only.
 *
 * Individual tests can still override with `vi.mock("obsidian", ...)`
 * — vi.mock takes precedence over this alias.
 */
export default defineConfig({
  test: {
    // Per-file `// @vitest-environment happy-dom` directives stay in
    // effect — the default remains node (DOM-free, fast).
  },
  resolve: {
    alias: {
      // Stub module — exports the minimum surface needed by component tests
      // when they don't apply their own vi.mock.
      obsidian: resolve(__dirname, "tests/unit/_helpers/obsidian-stub.ts"),
    },
  },
});
