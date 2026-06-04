import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { copyFile, mkdir, access } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

const banner = `/* obsidian-diagrams — bundled by esbuild. Source: github.com/nguyenkalix84 */`;

const prod = process.argv[2] === "production";

/**
 * Vault plugin folders that should receive the freshly-built artifacts.
 * Skipped silently if the folder is absent (e.g. on CI). To override on a
 * different machine, set OMNIBOARD_DEPLOY_VAULTS as ":"-separated paths.
 */
const DEFAULT_DEPLOY_TARGETS = [
  join(homedir(), "obsidian-vault/.obsidian/plugins/obsidian-omniboard"),
  join(homedir(), "dev/obsidian-omniboard-bmad/obsidian-vault-test/.obsidian/plugins/omniboard"),
];
const DEPLOY_TARGETS = process.env.OMNIBOARD_DEPLOY_VAULTS
  ? process.env.OMNIBOARD_DEPLOY_VAULTS.split(":").filter(Boolean)
  : DEFAULT_DEPLOY_TARGETS;
const DEPLOY_FILES = ["main.js", "manifest.json", "styles.css", "bpmn-native.css", "mermaid.min.js"];

async function deployToVaults() {
  for (const dest of DEPLOY_TARGETS) {
    try {
      await access(dest);
    } catch {
      // Vault folder missing — skip silently so the build still succeeds
      // on CI / fresh checkouts.
      continue;
    }
    await mkdir(dest, { recursive: true });
    for (const f of DEPLOY_FILES) {
      try { await copyFile(f, join(dest, f)); } catch (err) {
        console.warn(`[deploy] copy ${f} → ${dest} failed:`, err.message);
      }
    }
    console.log(`[deploy] ✓ ${dest}`);
  }
}

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    // CodeMirror 6 packages are provided by Obsidian at runtime; bundling
    // them would create duplicate instances and break editor extensions.
    // Same convention as Excalidraw, Dataview, and other major plugins.
    "@codemirror/view",
    "@codemirror/state",
    "@codemirror/language",
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  // Preact JSX
  jsx: "automatic",
  jsxImportSource: "preact",
  // Inline CSS imports as string. Required for `bpmn-native.css` to ship
  // inside main.js — mobile WebView can't reliably read sibling plugin
  // files via vault.adapter (sync timing + sandbox).
  loader: { ".css": "text" },
  outfile: "main.js",
});

if (prod) {
  await context.rebuild();
  await copyFile("src/bpmn-native/bpmn-native.css", "bpmn-native.css");
  await deployToVaults();
  process.exit(0);
} else {
  await copyFile("src/bpmn-native/bpmn-native.css", "bpmn-native.css");
  await deployToVaults();
  await context.watch();
}
