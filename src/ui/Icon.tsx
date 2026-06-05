import { h } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { setIcon } from "obsidian";

/**
 * Renders an Obsidian (Lucide) icon into a span via `setIcon`. Used by the
 * BoardEditor modal toolbar. In tests, `setIcon` is a no-op stub, so this
 * renders an empty span harmlessly.
 */
export function Icon({ name, className }: { name: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) setIcon(ref.current, name);
  }, [name]);
  return <span ref={ref} class={className ?? "diagrams-icon"} aria-hidden="true" />;
}
