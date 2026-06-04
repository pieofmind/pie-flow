/**
 * Pure utilities for testing wikilink targets against the
 * `.omniboard.md` / `.omniboard` extension family.
 *
 * Kept in its own file (separate from `liveEmbedExtension.ts`) so it
 * doesn't depend on `obsidian` / `@codemirror/*` — which lets it run
 * under Vitest without needing module mocks.
 */

import { OMNIBOARD_SUFFIX } from "../view/boardSerde";

/**
 * Test whether a wikilink target text refers to an `.omniboard.md` /
 * `.omniboard` file. Strips optional `#heading` / `#^block` anchor.
 */
export function isOmniboardLink(linkText: string): boolean {
  const path = linkText.replace(/#.*$/, "");
  return path.endsWith(OMNIBOARD_SUFFIX) || path.endsWith(".omniboard");
}
