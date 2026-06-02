// esbuild `loader: { ".css": "text" }` makes CSS imports resolve to string.
declare module "*.css" {
  const css: string;
  export default css;
}
