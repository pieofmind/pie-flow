/**
 * PROTOTYPE — vứt đi được, không merge vào main.
 * Câu hỏi: khung giao diện Pie Flow nên trông thế nào?
 * 4 phương án khác nhau về cấu trúc, cùng một canvas thật (OmniboardCanvas) và
 * board thật nếu có harness/prototype-board.local.json (không commit, repo public).
 *   A Bàn làm việc  — Linear / Vercel: sidebar cấu trúc, inspector neo phải, ⌘K, status bar
 *   B Đảo nổi       — Excalidraw / Apple: canvas tràn màn hình, mọi thứ là đảo nổi
 *   C Không gian    — Arc: sidebar "không gian" theo pool/lane, canvas đóng khung, sheet trượt
 *   D Chữ + sơ đồ   — dbdiagram.io: văn bản quy trình bên trái đồng bộ với sơ đồ
 */
import { OmniboardCanvas } from "../src/canvas/OmniboardCanvas";
import { registerAllShapes, SHAPE_CATEGORIES, shapeIcon } from "../src/canvas/shapes/index";
import type { CanvasModel } from "../src/canvas/types";

registerAllShapes();
const host = document.getElementById("host")!;
const app = document.getElementById("app")!;
const canvas = new OmniboardCanvas(host, SHAPE_CATEGORIES, () => refresh());
const cv = canvas as any; // prototype: gọi thẳng hàm private (setTool, openFlyout…)
const graph = cv.graph;

// ── Dữ liệu ──────────────────────────────────────────────────────────────
type N = CanvasModel["nodes"][number];
let model: CanvasModel = { nodes: [], edges: [] };
const TYPE: Record<string, string> = {
  "bpmn-task": "Việc", "bpmn-task-send": "Gửi tin", "bpmn-task-user": "Người làm", "bpmn-task-service": "Tự động",
  "bpmn-gateway-x": "Rẽ nhánh", "bpmn-gateway-event": "Chờ sự kiện", "bpmn-gateway-parallel": "Song song",
  "bpmn-event-start": "Bắt đầu", "bpmn-event-end": "Kết thúc", "bpmn-event-intermediate": "Sự kiện",
  "bpmn-data-store": "Kho dữ liệu", "bpmn-data-object": "Dữ liệu", "bpmn-annotation": "Ghi chú",
  "bpmn-subprocess": "Quy trình con", "bpmn-pool": "Pool",
};
const typeOf = (n: N) => TYPE[n.shape] ?? n.shape.replace(/^bpmn-/, "");
const label = (n: N) => (n.label || n.id).replace(/\s+/g, " ").trim();
const byId = (id: string) => model.nodes.find((n) => n.id === id);
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const icon = (n: N) => shapeIcon(n.shape, n.attrs as { trigger?: string } | undefined);

type Lane = { id: string; label: string; nodes: N[] };
type Pool = { node: N; lanes: Lane[]; loose: N[] };
function structure(): Pool[] {
  const pools = model.nodes.filter((n) => n.shape === "bpmn-pool");
  const items = model.nodes.filter((n) => n.shape !== "bpmn-pool" && !n.parentId);
  return pools.map((p) => {
    const lanes = ((p.attrs?.lanes as { id: string; label: string }[]) ?? []).map((l) => ({
      id: l.id, label: l.label, nodes: items.filter((n) => n.laneId === l.id).sort((a, b) => a.x - b.x),
    }));
    const inside = (n: N) => n.x >= p.x && n.x <= p.x + p.width && n.y >= p.y && n.y <= p.y + p.height;
    return { node: p, lanes, loose: items.filter((n) => !n.laneId && inside(n)) };
  });
}
const outgoing = (id: string) => model.edges.filter((e) => e.source === id);
const incoming = (id: string) => model.edges.filter((e) => e.target === id);

// ── Camera: chuyển cảnh có easing thay vì nhảy (Arc / Linear) ───────────
const ease = (t: number) => 1 - Math.pow(1 - t, 4);
let anim = 0;
function flyTo(r: { x: number; y: number; width: number; height: number }, maxScale = 1.1) {
  const box = cv.graphMount.getBoundingClientRect();
  const s1 = Math.min(maxScale, (box.width - 120) / r.width, (box.height - 120) / r.height);
  const area = graph.getGraphArea();
  const s0 = graph.scale().sx, c0 = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  const c1 = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  const t0 = performance.now(), id = ++anim, dur = 460;
  const step = (now: number) => {
    if (id !== anim) return;
    const t = ease(Math.min(1, (now - t0) / dur));
    graph.zoomTo(s0 + (s1 - s0) * t);
    graph.centerPoint(c0.x + (c1.x - c0.x) * t, c0.y + (c1.y - c0.y) * t);
    syncZoom();
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function focusNode(id: string) {
  const cell = graph.getCellById(id); if (!cell) return;
  graph.resetSelection(cell);
  const b = cell.getBBox();
  flyTo({ x: b.x - 160, y: b.y - 120, width: b.width + 320, height: b.height + 240 }, 1.2);
}
const fit = () => flyTo(graph.getContentBBox(), 1);
const zoomBy = (d: number) => { graph.zoom(d); syncZoom(); };
let zoomEls: HTMLElement[] = [];
function syncZoom() { const z = Math.round(graph.scale().sx * 100) + "%"; zoomEls.forEach((e) => (e.textContent = z)); }

// ── Icon giao diện (nét lucide, cùng họ với Obsidian) ───────────────────
const ic = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  cursor: ic('<path d="M4 4l7 17 2.5-7.5L21 11z"/>'),
  hand: ic('<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>'),
  arrow: ic('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  search: ic('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  plus: ic('<path d="M12 5v14M5 12h14"/>'), minus: ic('<path d="M5 12h14"/>'),
  fit: ic('<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>'),
  undo: ic('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: ic('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  chev: ic('<path d="M9 6l6 6-6 6"/>'), down: ic('<path d="M6 9l6 6 6-6"/>'),
  x: ic('<path d="M18 6L6 18M6 6l12 12"/>'), more: ic('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
  share: ic('<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/>'),
  check: ic('<path d="M20 6L9 17l-5-5"/>'), alert: ic('<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>'),
  layers: ic('<path d="M12 2l10 5-10 5L2 7z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>'),
  code: ic('<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>'), map: ic('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>'),
  sidebar: ic('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>'),
  panel: ic('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>'),
};
const h = (tag: string, cls = "", html = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

// Thanh công cụ dùng lại flyout thật của canvas (chèn hình được thật)
function toolButtons(bar: HTMLElement, opts: { below?: boolean; withLabels?: boolean } = {}) {
  const mk = (html: string, tip: string, kbd = "") => {
    const b = h("button", "p-tool", html + (opts.withLabels ? `<span>${tip}</span>` : ""));
    b.dataset.tip = kbd ? `${tip}  ${kbd}` : tip; bar.appendChild(b); return b;
  };
  const sel = mk(I.cursor, "Chọn", "V"), hand = mk(I.hand, "Kéo board", "H");
  const setTool = (t: "select" | "pan") => { cv.setTool(t); sel.classList.toggle("on", t === "select"); hand.classList.toggle("on", t === "pan"); };
  sel.onclick = () => setTool("select"); hand.onclick = () => setTool("pan"); setTool("select");
  bar.appendChild(h("i", "p-sep"));
  const place = (b: HTMLElement) => { if (!opts.below) return; const f = cv.flyout as HTMLElement | null; if (!f) return;
    const r = b.getBoundingClientRect(), rr = host.getBoundingClientRect();
    f.style.left = Math.max(8, r.left - rr.left + r.width / 2 - f.offsetWidth / 2) + "px"; f.style.top = r.bottom - rr.top + 10 + "px"; };
  const arrow = mk(I.arrow, "Mũi tên", "A"); arrow.onclick = () => { cv.openArrowFlyout(arrow); place(arrow); };
  for (const t of ["BPMN", "Flowchart", "ERD", "Cơ bản"]) {
    const cat = SHAPE_CATEGORIES.find((c) => c.title === t)!;
    const rep = { BPMN: "bpmn-task", Flowchart: "fc-decision", ERD: "erd-entity", "Cơ bản": "bs-rect" }[t] ?? cat.items[0].shape;
    const b = mk(shapeIcon(rep), t); b.classList.add("p-shape"); b.onclick = () => { cv.openFlyout(cat, b); place(b); };
  }
}

// ── ⌘K: một chỗ tìm cả phần tử lẫn lệnh (Linear / Vercel / Arc) ─────────
function commandPalette() {
  if (document.querySelector(".p-cmdk")) return;
  const wrap = h("div", "p-cmdk-scrim"), box = h("div", "p-cmdk");
  box.innerHTML = `<div class="p-cmdk-in">${I.search}<input placeholder="Tìm bước, làn, hoặc gõ lệnh…"/><kbd>esc</kbd></div><div class="p-cmdk-list"></div>`;
  wrap.appendChild(box); document.body.appendChild(wrap);
  const input = box.querySelector("input")!, list = box.querySelector(".p-cmdk-list")!;
  const actions = [
    { t: "Vừa khung", k: "⇧1", run: fit }, { t: "Hoàn tác", k: "⌘Z", run: () => canvas.undo() },
    { t: "Làm lại", k: "⇧⌘Z", run: () => canvas.redo() }, { t: "Tự sắp xếp ngang", k: "", run: () => canvas.autoLayout("LR") },
  ];
  let idx = 0, rows: { run: () => void }[] = [];
  const close = () => { wrap.classList.add("out"); setTimeout(() => wrap.remove(), 140); };
  const render = () => {
    const q = fold(input.value.trim());
    const nodes = model.nodes.filter((n) => n.shape !== "bpmn-pool" && (!q || fold(label(n)).includes(q))).slice(0, 7);
    const acts = actions.filter((a) => !q || fold(a.t).includes(q));
    rows = []; idx = Math.min(idx, nodes.length + acts.length - 1);
    let html = nodes.length ? `<div class="p-cmdk-h">Phần tử</div>` : "";
    nodes.forEach((n) => { html += `<div class="p-cmdk-row" data-i="${rows.length}"><span class="p-ico">${icon(n)}</span>${esc(label(n))}<em>${typeOf(n)}</em></div>`; rows.push({ run: () => focusNode(n.id) }); });
    if (acts.length) html += `<div class="p-cmdk-h">Lệnh</div>`;
    acts.forEach((a) => { html += `<div class="p-cmdk-row" data-i="${rows.length}"><span class="p-ico">${I.chev}</span>${a.t}${a.k ? `<kbd>${a.k}</kbd>` : ""}</div>`; rows.push({ run: a.run }); });
    list.innerHTML = html || `<div class="p-cmdk-empty">Không thấy gì khớp “${esc(input.value)}”</div>`;
    list.querySelectorAll<HTMLElement>(".p-cmdk-row").forEach((r) => {
      r.classList.toggle("on", +r.dataset.i! === idx);
      r.onmouseenter = () => { idx = +r.dataset.i!; render(); };
      r.onclick = () => { rows[+r.dataset.i!].run(); close(); };
    });
  };
  input.oninput = () => { idx = 0; render(); };
  input.onkeydown = (e) => {
    if (e.key === "ArrowDown") { idx = Math.min(rows.length - 1, idx + 1); render(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { idx = Math.max(0, idx - 1); render(); e.preventDefault(); }
    else if (e.key === "Enter") { rows[idx]?.run(); close(); }
    else if (e.key === "Escape") close();
    e.stopPropagation();
  };
  wrap.onmousedown = (e) => { if (e.target === wrap) close(); };
  render(); input.focus();
}

// ── Inspector: chung nội dung, mỗi phương án đặt một chỗ ────────────────
function inspectorHtml(n: N | null): string {
  if (!n) {
    const c = (s: string) => model.nodes.filter((x) => x.shape.startsWith(s)).length;
    return `<div class="p-insp-empty"><div class="p-insp-kicker">Board</div><div class="p-insp-big">${model.nodes.length - c("bpmn-pool")} bước</div>
      <div class="p-stats"><span><b>${c("bpmn-task")}</b> việc</span><span><b>${c("bpmn-gateway")}</b> rẽ nhánh</span><span><b>${c("bpmn-event")}</b> sự kiện</span><span><b>${model.edges.length}</b> luồng</span></div>
      <p class="p-hint">Chọn một bước trên board để xem chi tiết.</p></div>`;
  }
  const lane = structure().flatMap((p) => p.lanes).find((l) => l.id === n.laneId);
  const flow = (ids: string[], dir: string) => ids.map((id) => { const m = byId(id); return m ? `<button class="p-flow" data-go="${m.id}"><span class="p-ico">${icon(m)}</span><span>${esc(label(m))}</span><em>${dir}</em></button>` : ""; }).join("");
  const outs = flow(outgoing(n.id).map((e) => e.target), "→"), ins = flow(incoming(n.id).map((e) => e.source), "←");
  return `<div class="p-insp-head"><span class="p-ico lg">${icon(n)}</span><div><div class="p-insp-kicker">${typeOf(n)}${lane ? ` · ${esc(lane.label)}` : ""}</div>
      <div class="p-insp-title">${esc(label(n))}</div></div></div>
    <div class="p-kv"><span>ID</span><code>${esc(n.id)}</code></div>
    <div class="p-kv"><span>Vị trí</span><code>${Math.round(n.x)}, ${Math.round(n.y)} · ${n.width}×${n.height}</code></div>
    ${outs ? `<div class="p-sec">Đi tiếp</div>${outs}` : ""}${ins ? `<div class="p-sec">Đến từ</div>${ins}` : ""}`;
}
function bindInspector(el: HTMLElement) {
  el.onclick = (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-go]"); if (b) focusNode(b.dataset.go!); };
}
const selected = (): N | null => { const c = graph.getSelectedCells().filter((x: any) => x.isNode()); return c.length === 1 ? byId(c[0].id) ?? null : null; };

// ── Khung mỗi phương án ──────────────────────────────────────────────────
type Variant = { key: string; name: string; build: (root: HTMLElement) => { slot: HTMLElement; onSel?: () => void; onModel?: () => void } };

const outlineTree = (onPick: (id: string) => void, filter = "") => {
  const q = fold(filter); let html = "";
  for (const p of structure()) {
    html += `<div class="p-tree-pool"><span class="p-dot" style="--c:${p.lanes.length ? "var(--pg-accent)" : "var(--pg-text-soft)"}"></span>${esc(label(p.node))}</div>`;
    if (!p.lanes.length) { html += `<div class="p-tree-note">Hộp đen · chỉ trao đổi tin</div>`; continue; }
    for (const l of p.lanes) {
      const ns = l.nodes.filter((n) => n.shape !== "bpmn-annotation" && (!q || fold(label(n)).includes(q)));
      html += `<details class="p-tree-lane" open><summary>${I.chev}<span>${esc(l.label)}</span><em>${ns.length}</em></summary>`;
      ns.forEach((n) => (html += `<div class="p-tree-item" data-id="${n.id}"><span class="p-ico">${icon(n)}</span><span>${esc(label(n))}</span></div>`));
      html += `</details>`;
    }
  }
  const el = h("div", "p-tree", html);
  el.onclick = (e) => { const r = (e.target as HTMLElement).closest<HTMLElement>("[data-id]"); if (r) onPick(r.dataset.id!); };
  return el;
};
const markTree = (root: HTMLElement) => { const s = selected(); root.querySelectorAll<HTMLElement>("[data-id]").forEach((r) => r.classList.toggle("on", r.dataset.id === s?.id)); };

const VARIANTS: Variant[] = [
  { key: "A", name: "Bàn làm việc", build(root) {
    root.innerHTML = `
      <header class="a-top"><div class="a-crumb"><span>Omniboards</span>${I.chev}<b>to-be-hoi-thoai-fanpage-botcake</b><span class="a-saved">${I.check}Đã lưu</span></div>
        <button class="a-search">${I.search}<span>Tìm bước hoặc lệnh</span><kbd>⌘K</kbd></button>
        <div class="a-act"><button class="p-ghost">${I.alert}<span>0 lỗi BPMN</span></button><button class="p-ghost">Xuất</button><button class="p-primary">${I.share}Chia sẻ</button></div></header>
      <aside class="a-side"><div class="a-side-h"><span>Cấu trúc</span><input class="a-filter" placeholder="Lọc…"/></div><div class="a-tree"></div></aside>
      <main class="a-main"><div class="p-slot"></div><div class="a-rail"></div></main>
      <aside class="a-insp"><div class="a-tabs"><button class="on">Thuộc tính</button><button>Kiểm tra</button><button>Ghi chú</button></div><div class="a-body"></div></aside>
      <footer class="a-status"><span class="a-zoom">100%</span><span class="a-count"></span><span class="a-keys"><kbd>V</kbd> chọn <kbd>H</kbd> kéo <kbd>Space</kbd>+kéo <kbd>⌘</kbd>+cuộn zoom</span></footer>`;
    toolButtons(root.querySelector(".a-rail")!);
    root.querySelector<HTMLElement>(".a-search")!.onclick = commandPalette;
    zoomEls = [root.querySelector(".a-zoom")!];
    const body = root.querySelector<HTMLElement>(".a-body")!; bindInspector(body);
    const treeBox = root.querySelector<HTMLElement>(".a-tree")!, filter = root.querySelector<HTMLInputElement>(".a-filter")!;
    const drawTree = () => { treeBox.replaceChildren(outlineTree(focusNode, filter.value)); markTree(treeBox); };
    filter.oninput = drawTree;
    const onModel = () => { drawTree(); root.querySelector(".a-count")!.textContent = `${model.nodes.length} phần tử · ${model.edges.length} luồng`; body.innerHTML = inspectorHtml(selected()); };
    return { slot: root.querySelector(".p-slot")!, onModel, onSel: () => { body.innerHTML = inspectorHtml(selected()); markTree(treeBox); } };
  } },

  { key: "B", name: "Đảo nổi", build(root) {
    root.innerHTML = `<div class="p-slot b-full"></div>
      <div class="b-island b-file"><span class="b-logo">◐</span><b>to-be-hoi-thoai-fanpage-botcake</b>${I.down}</div>
      <div class="b-island b-tools"></div>
      <div class="b-island b-right"><button class="p-ghost">${I.search}<kbd>⌘K</kbd></button><button class="p-primary">${I.share}Chia sẻ</button></div>
      <div class="b-island b-zoom"><button data-z="-">${I.minus}</button><span class="b-zl">100%</span><button data-z="+">${I.plus}</button><i class="p-sep"></i><button data-z="fit">${I.fit}</button><i class="p-sep"></i><button data-z="u">${I.undo}</button><button data-z="r">${I.redo}</button></div>
      <div class="b-sel"></div>`;
    toolButtons(root.querySelector(".b-tools")!, { below: true });
    root.querySelector<HTMLElement>(".b-right .p-ghost")!.onclick = commandPalette;
    zoomEls = [root.querySelector(".b-zl")!];
    root.querySelector<HTMLElement>(".b-zoom")!.onclick = (e) => { const z = (e.target as HTMLElement).closest<HTMLElement>("[data-z]")?.dataset.z;
      if (z === "+") zoomBy(0.1); else if (z === "-") zoomBy(-0.1); else if (z === "fit") fit(); else if (z === "u") canvas.undo(); else if (z === "r") canvas.redo(); };
    const card = root.querySelector<HTMLElement>(".b-sel")!; bindInspector(card);
    const onSel = () => { const n = selected(); card.classList.toggle("show", !!n); if (n) card.innerHTML = inspectorHtml(n); };
    return { slot: root.querySelector(".p-slot")!, onSel, onModel: onSel };
  } },

  { key: "C", name: "Không gian", build(root) {
    root.innerHTML = `
      <aside class="c-side"><div class="c-file"><span class="b-logo">◐</span><div><b>fanpage-botcake</b><small>to-be · 23/10</small></div></div>
        <button class="c-search">${I.search}<span>Tìm…</span><kbd>⌘K</kbd></button>
        <div class="c-h">Không gian</div><div class="c-spaces"></div>
        <div class="c-h">Sơ đồ trong file</div><div class="c-diagrams"><div class="c-diag on">${I.layers}<span>Quy trình chính</span></div><div class="c-diag">${I.layers}<span>Quy trình con: Nhắc 2h·8h·20h</span></div></div>
        <div class="c-foot"><div class="c-tools"></div></div></aside>
      <main class="c-frame"><div class="p-slot"></div>
        <div class="c-zoom"><button data-z="fit">${I.fit}</button><span class="c-zl">100%</span></div>
        <aside class="c-sheet"><button class="c-close">${I.x}</button><div class="c-body"></div></aside></main>`;
    const tools = root.querySelector<HTMLElement>(".c-tools")!; toolButtons(tools);
    root.querySelector<HTMLElement>(".c-search")!.onclick = commandPalette;
    zoomEls = [root.querySelector(".c-zl")!];
    root.querySelector<HTMLElement>(".c-zoom")!.onclick = () => fit();
    const sheet = root.querySelector<HTMLElement>(".c-sheet")!, body = root.querySelector<HTMLElement>(".c-body")!; bindInspector(body);
    root.querySelector<HTMLElement>(".c-close")!.onclick = () => graph.cleanSelection();
    const spaces = root.querySelector<HTMLElement>(".c-spaces")!;
    const hues = ["#5E8FB9", "#B07F1E", "#7A9A5B", "#B86A5C", "#8A6FB0"];
    let active = "";
    const drawSpaces = () => {
      let i = 0, html = "";
      for (const p of structure()) {
        if (!p.lanes.length) { html += `<div class="c-space mute" data-pool="${p.node.id}"><span class="c-sw" style="--c:#9b8f86"></span><span>${esc(label(p.node))}</span></div>`; continue; }
        html += `<div class="c-space" data-pool="${p.node.id}"><span class="c-sw" style="--c:${hues[0]}"></span><span>${esc(label(p.node))}</span></div>`;
        for (const l of p.lanes) html += `<div class="c-lane" data-lane="${l.id}" data-pool="${p.node.id}"><span class="c-sw sm" style="--c:${hues[++i % hues.length]}"></span><span>${esc(l.label)}</span><em>${l.nodes.length}</em></div>`;
      }
      spaces.innerHTML = html;
      spaces.querySelectorAll<HTMLElement>("[data-pool]").forEach((r) => r.classList.toggle("on", (r.dataset.lane ?? r.dataset.pool) === active));
    };
    spaces.onclick = (e) => {
      const r = (e.target as HTMLElement).closest<HTMLElement>("[data-pool]"); if (!r) return;
      const p = byId(r.dataset.pool!)!; const laneId = r.dataset.lane;
      active = laneId ?? p.id; drawSpaces();
      if (!laneId) return flyTo(p, 1);
      const ns = model.nodes.filter((n) => n.laneId === laneId); if (!ns.length) return;
      const x0 = Math.min(...ns.map((n) => n.x)), y0 = Math.min(...ns.map((n) => n.y));
      flyTo({ x: x0 - 40, y: y0 - 40, width: Math.max(...ns.map((n) => n.x + n.width)) - x0 + 80, height: Math.max(...ns.map((n) => n.y + n.height)) - y0 + 80 }, 1);
    };
    const onSel = () => { const n = selected(); sheet.classList.toggle("open", !!n); if (n) body.innerHTML = inspectorHtml(n); };
    return { slot: root.querySelector(".p-slot")!, onSel, onModel: () => { drawSpaces(); onSel(); } };
  } },

  { key: "D", name: "Chữ + sơ đồ", build(root) {
    root.innerHTML = `
      <header class="d-top"><div class="d-seg"><button>${I.code}Văn bản</button><button class="on">${I.sidebar}Chia đôi</button><button>${I.map}Sơ đồ</button></div>
        <b class="d-name">to-be-hoi-thoai-fanpage-botcake</b><div class="d-act"><span class="d-ok">${I.check}Khớp sơ đồ</span><button class="p-ghost">${I.search}<kbd>⌘K</kbd></button><button class="p-primary">Xuất .bpmn</button></div></header>
      <section class="d-code"><div class="d-lines"></div></section>
      <main class="d-canvas"><div class="p-slot"></div><div class="d-tools"></div><div class="d-zoom"><button data-z="-">${I.minus}</button><span class="d-zl">100%</span><button data-z="+">${I.plus}</button><button data-z="fit">${I.fit}</button></div></main>`;
    toolButtons(root.querySelector(".d-tools")!);
    root.querySelector<HTMLElement>(".d-act .p-ghost")!.onclick = commandPalette;
    zoomEls = [root.querySelector(".d-zl")!];
    root.querySelector<HTMLElement>(".d-zoom")!.onclick = (e) => { const z = (e.target as HTMLElement).closest<HTMLElement>("[data-z]")?.dataset.z; if (z === "+") zoomBy(0.1); else if (z === "-") zoomBy(-0.1); else if (z === "fit") fit(); };
    const seg = root.querySelector<HTMLElement>(".d-seg")!;
    seg.onclick = (e) => { const b = (e.target as HTMLElement).closest("button"); if (!b) return; seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      root.dataset.mode = ["text", "split", "map"][[...seg.children].indexOf(b)]; setTimeout(() => graph.resize(), 300); };
    const lines = root.querySelector<HTMLElement>(".d-lines")!;
    const kw = (s: string) => `<span class="k">${s}</span>`, str = (s: string) => `<span class="s">"${esc(s)}"</span>`, cm = (s: string) => `<span class="c">// ${esc(s)}</span>`;
    const draw = () => {
      const out: string[] = [];
      const node = (n: N, ind: string) => {
        const nxt = outgoing(n.id).map((e) => byId(e.target)).filter(Boolean) as N[];
        out.push(`<div class="d-ln" data-id="${n.id}">${ind}${kw(typeOf(n).toLowerCase().replace(/ /g, "_"))} ${str(label(n))}</div>`);
        nxt.forEach((m) => out.push(`<div class="d-ln sub" data-id="${n.id}">${ind}  <span class="o">→</span> ${esc(label(m))}</div>`));
      };
      for (const p of structure()) {
        out.push(`<div class="d-ln">${kw("pool")} ${str(label(p.node))} {${p.lanes.length ? "" : "  " + cm("hộp đen")}</div>`);
        for (const l of p.lanes) {
          out.push(`<div class="d-ln">  ${kw("lane")} ${str(l.label)} {</div>`);
          l.nodes.filter((n) => n.shape !== "bpmn-annotation").forEach((n) => node(n, "    "));
          out.push(`<div class="d-ln">  }</div>`);
        }
        out.push(`<div class="d-ln">}</div><div class="d-ln">&nbsp;</div>`);
      }
      lines.innerHTML = out.map((l, i) => l.replace('class="d-ln', `data-n="${i + 1}" class="d-ln`)).join("");
    };
    lines.onclick = (e) => { const r = (e.target as HTMLElement).closest<HTMLElement>("[data-id]"); if (r) focusNode(r.dataset.id!); };
    const onSel = () => { const s = selected(); let first: HTMLElement | null = null;
      lines.querySelectorAll<HTMLElement>(".d-ln").forEach((r) => { const on = !!s && r.dataset.id === s.id; r.classList.toggle("on", on); if (on && !first) first = r; });
      (first as HTMLElement | null)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); };
    return { slot: root.querySelector(".p-slot")!, onSel, onModel: () => { draw(); onSel(); } };
  } },
];

// ── Ráp + thanh đổi phương án ───────────────────────────────────────────
let current: ReturnType<Variant["build"]> | null = null;
function refresh() { model = canvas.getModel(); current?.onModel?.(); }
function mount(key: string) {
  const v = VARIANTS.find((x) => x.key === key) ?? VARIANTS[0];
  const root = h("div", `p-root v-${v.key}`); app.replaceChildren(root);
  current = v.build(root);
  current.slot.appendChild(host);
  document.body.dataset.variant = v.key;
  bar.querySelector(".p-sw-name")!.innerHTML = `<b>${v.key}</b> ${v.name}`;
  requestAnimationFrame(() => { graph.resize(); refresh(); current?.onSel?.(); syncZoom(); });
}
const bar = h("div", "p-switch", `<button data-d="-1">${I.chev}</button><span class="p-sw-name"></span><button data-d="1">${I.chev}</button>`);
document.body.appendChild(bar);
const go = (d: number) => {
  const i = VARIANTS.findIndex((v) => v.key === (new URLSearchParams(location.search).get("variant") ?? "A"));
  const next = VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length].key;
  const q = new URLSearchParams(location.search); q.set("variant", next); history.replaceState(null, "", `?${q}`); mount(next);
};
bar.onclick = (e) => { const d = (e.target as HTMLElement).closest<HTMLElement>("[data-d]")?.dataset.d; if (d) go(+d); };
document.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (t.closest("input,textarea,[contenteditable]")) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); commandPalette(); }
  else if (e.key === "ArrowLeft" && e.altKey) go(-1);
  else if (e.key === "ArrowRight" && e.altKey) go(1);
});
graph.on("selection:changed", () => current?.onSel?.());
graph.on("scale", syncZoom);
(window as any).__proto = { canvas, graph, go };

(async () => {
  let m: CanvasModel | null = null;
  try { const r = await fetch("./prototype-board.local.json", { cache: "reload" }); if (r.ok) m = await r.json(); } catch { /* không có board thật */ }
  if (m) canvas.loadModel(m);
  mount(new URLSearchParams(location.search).get("variant") ?? "A");
  setTimeout(() => { graph.zoomToFit({ padding: 40, maxScale: 1 }); syncZoom(); }, 300);
})();
