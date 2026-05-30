import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Theme } from "../../core/adapter";

interface MermaidRendererProps {
  model: string;
  theme: Theme;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: Window & { mermaid?: any };

let loadPromise: Promise<void> | null = null;
let nextId = 0;
let initialized = false;

/** Load mermaid.min.js from the plugin folder via script tag (lazy, once). */
function loadMermaidScript(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise<void>((resolve, reject) => {
    if (window.mermaid) { resolve(); return; }
    const script = document.createElement("script");
    // Obsidian exposes plugin folder via app.vault.adapter.basePath + app path,
    // but the simplest cross-platform way is a relative URL from the vault root.
    // The plugin lives at .obsidian/plugins/obsidian-omniboard/
    const pluginDir = (window as Window & { app?: { vault?: { adapter?: { basePath?: string } }; plugins?: { getPlugin?: (id: string) => { manifest?: { dir?: string } } | null } } }).app
      ?.plugins?.getPlugin?.("obsidian-omniboard")?.manifest?.dir
      ?? ".obsidian/plugins/obsidian-omniboard";
    // Use file:// protocol with basePath for desktop
    const basePath = (window as Window & { app?: { vault?: { adapter?: { basePath?: string } } } }).app?.vault?.adapter?.basePath;
    script.src = basePath
      ? `file://${basePath}/${pluginDir}/mermaid.min.js`
      : `${pluginDir}/mermaid.min.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("mermaid.min.js 로드 실패 — plugin 폴더에 mermaid.min.js가 없습니다"));
    document.head.appendChild(script);
  });
  return loadPromise;
}

function initMermaid(isDark: boolean): void {
  if (initialized) return;
  initialized = true;
  window.mermaid?.initialize?.({
    startOnLoad: false,
    securityLevel: "loose",
    theme: isDark ? "dark" : "default",
    themeVariables: {
      fontFamily: '"Be Vietnam Pro", system-ui, sans-serif',
      primaryColor: "#eaf1ff",
      primaryTextColor: "#3B1F1A",
      primaryBorderColor: "#5E8FB9",
      lineColor: "#9c8b7e",
      background: "transparent",
    },
  });
}

export function MermaidRenderer({ model, theme }: MermaidRendererProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        await loadMermaidScript();
        if (cancelled) return;
        initMermaid(theme.isDark ?? false);
        const id = `mermaid-dx-${++nextId}`;
        const src = model.trim() || "graph LR\n  A --> B";
        const { svg } = await window.mermaid.render(id, src);
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = svg;
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [model, theme.isDark]);

  if (loading && !error) {
    return <div class="diagrams-mermaid-loading">Đang tải Mermaid…</div>;
  }
  if (error) {
    return (
      <pre class="diagrams-mermaid-error">⚠️ {error}{"\n\n"}{model}</pre>
    );
  }
  return <div ref={hostRef} class="diagrams-mermaid-host" />;
}
