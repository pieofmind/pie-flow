/**
 * Story 7-20 — Inline card export backends.
 *
 * The inline `<DiagramCard>` has no live OmniboardCanvas instance (it
 * shows a static preview rendered from the parsed model). For exports
 * we use the SAME static SVG path that BoardView uses for thumbnails
 * (`renderModelToSvg`), then convert SVG → PNG → PDF as needed.
 *
 * For adapters whose model isn't a `CanvasModel` shape (most stub
 * adapters return a raw string), full rasterization isn't meaningful —
 * we fall back to saving the serialized source as a text file with the
 * adapter's code-block language as the extension. The caller decides
 * which path applies based on `isCanvasModel()`.
 */

import { renderModelToSvg } from "../canvas/staticRender";
import type { CanvasModel } from "../canvas/types";
import type { DiagramAdapter, ExportFormat } from "../core/adapter";

/**
 * Duck-type a value as `CanvasModel`. Cheap structural check —
 * adapters returning a raw `string` from parse() will fail this and
 * route to the source-export fallback.
 */
export function isCanvasModel(model: unknown): model is CanvasModel {
  if (typeof model !== "object" || model === null) return false;
  const m = model as { nodes?: unknown; edges?: unknown };
  return Array.isArray(m.nodes) && Array.isArray(m.edges);
}

/** Export a CanvasModel as a standalone SVG document. */
export function exportSvg(model: CanvasModel): string {
  return renderModelToSvg(model, "", 24, "#ffffff");
}

/**
 * Export a CanvasModel as a PNG Blob via offscreen `<canvas>`
 * rasterization at the given scale (2 = retina, 4 = print).
 *
 * Throws on SVG decode failure (corrupt model) — caller is expected
 * to catch and surface a Notice.
 */
export async function exportPng(
  model: CanvasModel,
  scale = 2,
): Promise<Blob> {
  const svg = exportSvg(model);
  const url =
    "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("SVG decode failed"));
    img.src = url;
  });
  const w = img.width || 800;
  const h = img.height || 600;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D context");
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob failed"))),
      "image/png",
    ),
  );
}

/**
 * Export a CanvasModel as a single-page A4 PDF (orientation auto-
 * picked from the diagram aspect ratio). Returns raw bytes.
 */
export async function exportPdf(model: CanvasModel): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const blob = await exportPng(model, 2);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("read PNG failed"));
    r.readAsDataURL(blob);
  });
  // Probe PNG dimensions to choose orientation.
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("decode PNG failed"));
    img.src = dataUrl;
  });
  const orient = img.width >= img.height ? "landscape" : "portrait";
  const pdf = new jsPDF({ orientation: orient, unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  // Fit image into page with 10mm margin, preserving aspect ratio.
  const margin = 10;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;
  const ratio = Math.min(maxW / img.width, maxH / img.height);
  const drawW = img.width * ratio;
  const drawH = img.height * ratio;
  const x = (pageW - drawW) / 2;
  const y = (pageH - drawH) / 2;
  pdf.addImage(dataUrl, "PNG", x, y, drawW, drawH);
  return new Uint8Array(pdf.output("arraybuffer"));
}

/**
 * Persist a Blob / string / ArrayBuffer to disk. Uses the modern
 * `showSaveFilePicker` API when available (Chromium-based Obsidian
 * desktop) and falls back to the classic anchor-download trick.
 */
export async function saveToDisk(
  data: Blob | string | ArrayBuffer | Uint8Array,
  suggestedName: string,
  mimeType: string,
): Promise<string | null> {
  let blob: Blob;
  if (data instanceof Blob) {
    blob = data;
  } else if (data instanceof Uint8Array) {
    blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer], { type: mimeType });
  } else {
    blob = new Blob([data], { type: mimeType });
  }

  interface PickerType {
    description: string;
    accept: Record<string, string[]>;
  }
  interface PickerWindow {
    showSaveFilePicker?: (opts: {
      suggestedName?: string;
      types?: PickerType[];
    }) => Promise<{
      createWritable: () => Promise<{
        write: (data: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
      name?: string;
    }>;
  }

  const w = window as unknown as PickerWindow;
  if (typeof w.showSaveFilePicker === "function") {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: mimeType,
            accept: { [mimeType]: ["." + suggestedName.split(".").pop()] },
          },
        ],
      });
      const stream = await handle.createWritable();
      await stream.write(blob);
      await stream.close();
      return handle.name ?? suggestedName;
    } catch {
      // User cancelled or API unavailable — fall through to anchor fallback.
      return null;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return suggestedName;
}

/**
 * High-level dispatcher: given an adapter + parsed model + chosen
 * format, do the right thing. For CanvasModel-shaped models we
 * rasterize via the static path; for stub adapters we save the
 * serialized source with the adapter's code-block extension.
 *
 * Returns the saved filename on success, `null` if user cancelled.
 * Throws on actual export failure (caller surfaces a Notice).
 */
export async function exportDiagramCard<TModel>(
  adapter: DiagramAdapter<TModel>,
  model: TModel,
  format: ExportFormat,
  baseName: string,
): Promise<string | null> {
  if (isCanvasModel(model)) {
    switch (format) {
      case "svg": {
        const svg = exportSvg(model);
        return saveToDisk(svg, `${baseName}.svg`, "image/svg+xml");
      }
      case "png": {
        const png = await exportPng(model, 2);
        return saveToDisk(png, `${baseName}.png`, "image/png");
      }
      case "pdf": {
        const pdf = await exportPdf(model);
        return saveToDisk(pdf, `${baseName}.pdf`, "application/pdf");
      }
    }
  }

  // Stub adapters: model is raw source. Save serialized source with
  // the adapter's code-block language as the extension (.bpmn, .mmd,
  // .erd, ...). For SVG / PNG / PDF formats this is a graceful
  // degrade — without a canvas-shaped model we can't rasterize.
  const text = adapter.serialize(model);
  const ext = adapter.codeBlockLanguage || "txt";
  return saveToDisk(text, `${baseName}.${ext}`, "text/plain");
}

/**
 * Copy a CanvasModel as PNG to the system clipboard.
 * For non-CanvasModel adapters, fall back to copying the serialized
 * source as plain text. Returns true on success.
 */
export async function copyCardAsImage<TModel>(
  adapter: DiagramAdapter<TModel>,
  model: TModel,
): Promise<boolean> {
  if (isCanvasModel(model)) {
    try {
      const png = await exportPng(model, 2);
      const item = new ClipboardItem({ "image/png": png });
      await navigator.clipboard.write([item]);
      return true;
    } catch {
      return false;
    }
  }
  // Fall back to text copy for stub adapters.
  try {
    await navigator.clipboard.writeText(adapter.serialize(model));
    return true;
  } catch {
    return false;
  }
}
