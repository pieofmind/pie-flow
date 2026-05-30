import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const banner = `/* obsidian-diagrams — bundled by esbuild. Source: github.com/nguyenkalix84 */`;

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  // Preact JSX
  jsx: "automatic",
  jsxImportSource: "preact",
  outfile: "main.js",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
