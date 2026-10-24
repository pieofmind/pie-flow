/**
 * PROTOTYPE — vứt đi được, không merge vào main.
 * Câu hỏi: khung giao diện Pie Flow nên sắp xếp thế nào?
 * Nguyên tắc: KHÔNG vẽ lại thành phần nào plugin đã có. Mọi phương án dùng đúng các mảnh thật —
 * thanh trên (buildBoardTopbar), thanh công cụ trái, bảng Thuộc tính, thanh ngữ cảnh, tìm kiếm,
 * breadcrumb quy trình con, zoom, minimap, lỗi BPMN (validateBpmnModel) — chỉ đặt chúng chỗ khác.
 * Mảnh nào là ý tưởng MỚI (chưa có trong plugin) thì gắn nhãn "Mới".
 * Màu: biến theme Border (tối, nhấn teal) đọc từ Obsidian của anh Nguyên; mặt giấy giữ token .lk-root.
 *   0 Hiện tại · A Bàn làm việc (Linear/Vercel) · B Đảo nổi (Excalidraw) · C Không gian (Arc) · D Chữ + sơ đồ (dbdiagram)
 */
import { iconSvg } from "./proto-obsidian-shim";
import { OmniboardCanvas } from "../src/canvas/OmniboardCanvas";
import { registerAllShapes, SHAPE_CATEGORIES, shapeIcon } from "../src/canvas/shapes/index";
import { buildBoardTopbar } from "../src/ui/boardTopbar";
import { validateBpmnModel } from "../src/io/bpmn/validator";
import type { CanvasModel } from "../src/canvas/types";

registerAllShapes();
const h = (tag: string, cls = "", html = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
const app = document.getElementById("app")!;

// Khung thật: .da-board-view > .da-topbar + host canvas (giống BoardView.onOpen)
const view = h("div", "da-board-view p-view");
const topbar = h("div", "da-topbar");
const host = h("div", "da-board-host p-host");
view.append(topbar, host);
app.appendChild(view); // canvas cần nằm trong DOM khi khởi tạo
const canvas = new OmniboardCanvas(host, SHAPE_CATEGORIES, () => refresh());
const cv = canvas as any; // prototype: gọi thẳng hàm private
const graph = cv.graph;

// ── Toast: nút cần Obsidian (mở leaf, xuất file…) chỉ báo chứ không giả làm ──
function toast(msg: string) {
  const t = h("div", "p-toast", msg); document.body.appendChild(t);
  setTimeout(() => t.classList.add("out"), 1800); setTimeout(() => t.remove(), 2100);
}
const inObsidian = (what: string) => () => toast(`Trong Obsidian: ${what}`);
let openIssuesWhereverTheyLive = () => toast("Trong Obsidian: mở bảng BPMN issues bên phải");
buildBoardTopbar(topbar, {
  getCanvas: () => canvas, badgeLabel: "BOARD", badgeIcon: "shapes", title: "to-be-hoi-thoai-fanpage-botcake.omniboard",
  onClose: inObsidian("đóng tab board"), onSave: inObsidian("lưu rồi đóng"), onExport: inObsidian("menu Export SVG / PNG / PDF"),
  extraButtons: [
    { icon: "sliders-horizontal", tip: "BPMN properties", onClick: inObsidian("mở bảng BPMN properties bên phải") },
    { icon: "alert-triangle", tip: "BPMN issues", onClick: () => openIssuesWhereverTheyLive() },
    { icon: "workflow", tip: "Chuyển sang BPMN Native", onClick: inObsidian("chuyển sang BPMN Native") },
    { icon: "file-text", tip: "Mở dưới dạng Markdown", onClick: inObsidian("mở dạng Markdown") },
    { icon: "upload", tip: "Import (BPMN / DBML)", onClick: inObsidian("chọn file BPMN / DBML để import") },
  ],
});
const tbBtn = (tip: string) => topbar.querySelector<HTMLElement>(`[aria-label="${tip}"]`);
const EXTRA_TIPS = ["BPMN properties", "BPMN issues", "Chuyển sang BPMN Native", "Mở dưới dạng Markdown", "Import (BPMN / DBML)"];

// ── Dữ liệu ──────────────────────────────────────────────────────────────
type N = CanvasModel["nodes"][number];
let model: CanvasModel = { nodes: [], edges: [] };
const label = (n: N) => (n.label || n.id).replace(/\s+/g, " ").trim();
const byId = (id: string) => model.nodes.find((n) => n.id === id);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const icon = (n: N) => shapeIcon(n.shape, n.attrs as { trigger?: string } | undefined);
type Lane = { id: string; label: string; nodes: N[] };
function structure() {
  const items = model.nodes.filter((n) => n.shape !== "bpmn-pool" && !n.parentId);
  return model.nodes.filter((n) => n.shape === "bpmn-pool").map((p) => ({
    node: p,
    lanes: ((p.attrs?.lanes as { id: string; label: string }[]) ?? []).map((l): Lane => ({
      id: l.id, label: l.label, nodes: items.filter((n) => n.laneId === l.id && n.shape !== "bpmn-annotation").sort((a, b) => a.x - b.x),
    })),
  }));
}

// ── Camera lướt có easing (dùng cho điều hướng mới) ─────────────────────
let anim = 0;
function flyTo(r: { x: number; y: number; width: number; height: number }, maxScale = 1.1) {
  const box = cv.graphMount.getBoundingClientRect();
  const s1 = Math.min(maxScale, (box.width - 120) / r.width, (box.height - 120) / r.height);
  const a = graph.getGraphArea(), s0 = graph.scale().sx;
  const c0 = { x: a.x + a.width / 2, y: a.y + a.height / 2 }, c1 = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  const t0 = performance.now(), id = ++anim;
  const step = (now: number) => {
    if (id !== anim) return;
    const t = 1 - Math.pow(1 - Math.min(1, (now - t0) / 460), 4);
    graph.zoomTo(s0 + (s1 - s0) * t); graph.centerPoint(c0.x + (c1.x - c0.x) * t, c0.y + (c1.y - c0.y) * t);
    cv.updateZoom?.();
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
function focusLane(laneId: string) {
  const ns = model.nodes.filter((n) => n.laneId === laneId); if (!ns.length) return;
  const x0 = Math.min(...ns.map((n) => n.x)), y0 = Math.min(...ns.map((n) => n.y));
  flyTo({ x: x0 - 40, y: y0 - 40, width: Math.max(...ns.map((n) => n.x + n.width)) - x0 + 80, height: Math.max(...ns.map((n) => n.y + n.height)) - y0 + 80 }, 1);
}

// ── Mảnh dùng chung ─────────────────────────────────────────────────────
const NEW = `<span class="p-new">Mới</span>`;
/** Cùng dữ liệu + cùng class với BpmnIssuesView (obi-row), chỉ đặt chỗ khác. */
function issuesList(): HTMLElement {
  const issues = validateBpmnModel(model);
  const el = h("div", "p-issues omniboard-issues-view");
  el.innerHTML = issues.length
    ? issues.map((i) => `<button class="obi-row ${i.severity}" data-id="${esc(i.targetId)}"><span class="obi-code">${esc(i.code)}</span><span class="obi-msg">${esc(i.message)}</span></button>`).join("")
    : `<div class="p-muted">Không phát hiện lỗi semantic.</div>`;
  el.onclick = (e) => { const r = (e.target as HTMLElement).closest<HTMLElement>("[data-id]"); if (r) focusNode(r.dataset.id!); };
  return el;
}
function outlineTree(): HTMLElement {
  let html = "";
  for (const p of structure()) {
    html += `<div class="p-tree-pool">${esc(label(p.node))}</div>`;
    if (!p.lanes.length) { html += `<div class="p-muted p-indent">Hộp đen · chỉ trao đổi tin</div>`; continue; }
    for (const l of p.lanes) {
      html += `<details class="p-tree-lane" open><summary>${iconSvg("chevron-right")}<span>${esc(l.label)}</span><em>${l.nodes.length}</em></summary>`;
      l.nodes.forEach((n) => (html += `<div class="p-tree-item" data-id="${n.id}"><span class="p-ico">${icon(n)}</span><span>${esc(label(n))}</span></div>`));
      html += `</details>`;
    }
  }
  const el = h("div", "p-tree", html);
  el.onclick = (e) => { const r = (e.target as HTMLElement).closest<HTMLElement>("[data-id]"); if (r) focusNode(r.dataset.id!); };
  return el;
}

// ── Các phương án: chỉ đổi chỗ, không vẽ lại ────────────────────────────
type Built = { onModel?: () => void; onSel?: () => void };
type Variant = { key: string; name: string; build: (root: HTMLElement) => Built };
const selectedId = () => { const c = graph.getSelectedCells().filter((x: any) => x.isNode()); return c.length === 1 ? c[0].id : null; };
const openProps = (open: boolean) => cv.togglePropsPanel(open);

const VARIANTS: Variant[] = [
  { key: "0", name: "Hiện tại", build(root) { root.append(view); return {}; } },

  { key: "A", name: "Bàn làm việc", build(root) {
    // Nút phụ (BPMN properties / issues / Native / Markdown / Import) gom vào "…"
    const more = h("button", "da-tb-ic p-more", iconSvg("more-horizontal")); more.title = "Thêm";
    const pop = h("div", "p-pop");
    EXTRA_TIPS.forEach((t) => { const b = tbBtn(t); if (b) { b.insertAdjacentHTML("beforeend", `<span>${t}</span>`); pop.appendChild(b); } });
    topbar.querySelector(".da-tb-divider")?.replaceWith(more);
    more.onclick = (e) => { e.stopPropagation(); pop.classList.toggle("open"); };
    document.addEventListener("click", () => pop.classList.remove("open"));
    topbar.appendChild(pop);
    const side = h("aside", "a-side", `<div class="a-tabs"><button class="on" data-t="tree">Cấu trúc ${NEW}</button><button data-t="iss">Lỗi BPMN <b class="a-n"></b></button></div><div class="a-pane"></div>`);
    const main = h("div", "a-main"); main.append(side, host);
    view.replaceChildren(topbar, main); root.append(view);
    let tab = "tree";
    const pane = side.querySelector<HTMLElement>(".a-pane")!;
    const mark = () => pane.querySelectorAll<HTMLElement>("[data-id]").forEach((r) => r.classList.toggle("on", r.dataset.id === selectedId()));
    const draw = () => { pane.replaceChildren(tab === "tree" ? outlineTree() : issuesList()); side.querySelector(".a-n")!.textContent = String(validateBpmnModel(model).length); mark(); };
    side.querySelector<HTMLElement>(".a-tabs")!.onclick = (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-t]"); if (!b) return; tab = b.dataset.t!;
      side.querySelectorAll(".a-tabs button").forEach((x) => x.classList.toggle("on", x === b)); draw(); };
    openIssuesWhereverTheyLive = () => side.querySelector<HTMLElement>('[data-t="iss"]')!.click();
    return { onModel: draw, onSel: () => { mark(); openProps(true); } };
  } },

  { key: "B", name: "Đảo nổi", build(root) {
    // Thanh trên tách 3 đảo nổi trên canvas: [Đóng · BOARD · tên] — [hành động] — [Export · Lưu & đóng]
    const left = h("div", "b-isl b-isl-l"), mid = h("div", "b-isl b-isl-m"), right = h("div", "b-isl b-isl-r");
    for (const k of [...topbar.children] as HTMLElement[]) {
      if (k.matches(".da-tb-close,.da-tb-badge,.da-tb-title")) left.appendChild(k);
      else if (k.matches(".da-tb-save") || k.getAttribute("aria-label") === "Export") right.appendChild(k);
      else if (!k.matches(".da-tb-grow,.da-tb-divider")) mid.appendChild(k);
    }
    topbar.replaceChildren(left, mid, right);
    view.replaceChildren(host); host.append(topbar); root.append(view);
    return {};
  } },

  { key: "C", name: "Không gian", build(root) {
    const side = h("aside", "c-side");
    const head = h("div", "c-head"); head.append(...topbar.querySelectorAll<HTMLElement>(".da-tb-badge,.da-tb-title"));
    const acts = h("div", "c-acts"); acts.append(...topbar.querySelectorAll<HTMLElement>(".da-tb-ic"));
    const spaces = h("div", "c-spaces"), iss = h("div", "c-iss");
    const foot = h("div", "c-foot"); foot.append(...topbar.querySelectorAll<HTMLElement>(".da-tb-close,.da-tb-save"));
    side.append(head, acts, h("div", "c-h", `Không gian ${NEW}`), spaces, h("div", "c-h", "Lỗi BPMN"), iss, foot);
    const frame = h("main", "c-frame"); frame.append(host);
    view.replaceChildren(side, frame); root.append(view);
    let active = "";
    const hues = ["#5E8FB9", "#B07F1E", "#7A9A5B", "#B86A5C", "#8A6FB0"];
    const draw = () => {
      let i = 0, html = "";
      for (const p of structure()) {
        html += `<div class="c-space${p.lanes.length ? "" : " mute"}" data-pool="${p.node.id}"><span class="c-sw" style="--c:${p.lanes.length ? hues[0] : "#748b8b"}"></span><span>${esc(label(p.node))}</span></div>`;
        for (const l of p.lanes) html += `<div class="c-lane" data-lane="${l.id}" data-pool="${p.node.id}"><span class="c-sw sm" style="--c:${hues[++i % hues.length]}"></span><span>${esc(l.label)}</span><em>${l.nodes.length}</em></div>`;
      }
      spaces.innerHTML = html;
      spaces.querySelectorAll<HTMLElement>("[data-pool]").forEach((r) => r.classList.toggle("on", (r.dataset.lane ?? r.dataset.pool) === active));
      iss.replaceChildren(issuesList());
    };
    spaces.onclick = (e) => {
      const r = (e.target as HTMLElement).closest<HTMLElement>("[data-pool]"); if (!r) return;
      active = r.dataset.lane ?? r.dataset.pool!; draw();
      if (r.dataset.lane) focusLane(r.dataset.lane); else flyTo(byId(r.dataset.pool!)!, 1);
    };
    openIssuesWhereverTheyLive = () => iss.scrollIntoView({ behavior: "smooth" });
    return { onModel: draw, onSel: () => openProps(!!selectedId()) };
  } },

  { key: "D", name: "Chữ + sơ đồ", build(root) {
    const code = h("section", "d-code", `<div class="d-head">${iconSvg("code")}<span>Văn bản quy trình</span>${NEW}<em>chỉ đọc</em></div><div class="d-lines"></div>`);
    const split = h("div", "d-split"); split.append(code, host);
    view.replaceChildren(topbar, split); root.append(view);
    const lines = code.querySelector<HTMLElement>(".d-lines")!;
    const kw = (s: string) => `<span class="k">${s}</span>`, str = (s: string) => `<span class="s">"${esc(s)}"</span>`;
    const mark = () => { let first: HTMLElement | null = null; const s = selectedId();
      lines.querySelectorAll<HTMLElement>(".d-ln").forEach((r) => { const on = !!s && r.querySelector(`[data-id="${s}"]`) !== null; r.classList.toggle("on", on); if (on && !first) first = r; });
      (first as HTMLElement | null)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); };
    const draw = () => {
      const out: string[] = [];
      for (const p of structure()) {
        out.push(`${kw("pool")} ${str(label(p.node))} {${p.lanes.length ? "" : ` <span class="c">// hộp đen</span>`}`);
        for (const l of p.lanes) {
          out.push(`  ${kw("lane")} ${str(l.label)} {`);
          for (const n of l.nodes) {
            out.push(`<span data-id="${n.id}">    ${kw(n.shape.replace(/^bpmn-/, ""))} ${str(label(n))}</span>`);
            model.edges.filter((e) => e.source === n.id).forEach((e) => { const m = byId(e.target); if (m) out.push(`<span data-id="${n.id}" class="sub">      <span class="o">→</span> ${esc(label(m))}</span>`); });
          }
          out.push("  }");
        }
        out.push("}", " ");
      }
      lines.innerHTML = out.map((l, i) => `<div class="d-ln" data-n="${i + 1}">${l}</div>`).join("");
      mark();
    };
    lines.onclick = (e) => { const r = (e.target as HTMLElement).closest<HTMLElement>("[data-id]"); if (r) focusNode(r.dataset.id!); };
    return { onModel: draw, onSel: mark };
  } },
];

// ── Ráp + thanh đổi phương án + bảng đối chiếu ──────────────────────────
let current: Built | null = null;
function refresh() { model = canvas.getModel(); current?.onModel?.(); }
const keyNow = new URLSearchParams(location.search).get("variant") ?? "0";
const v = VARIANTS.find((x) => x.key === keyNow) ?? VARIANTS[0];
// Mỗi lần đổi phương án nạp lại trang (DOM thật đã bị chuyển chỗ), giữ nguyên góc nhìn
const go = (d: number) => {
  sessionStorage.setItem("proto-view", JSON.stringify({ s: graph.scale().sx, t: graph.translate() }));
  const q = new URLSearchParams(location.search); q.set("variant", VARIANTS[(VARIANTS.indexOf(v) + d + VARIANTS.length) % VARIANTS.length].key);
  location.search = q.toString();
};
const MAP: [string, string[]][] = [
  ["Đóng · BOARD · tên sơ đồ", ["Thanh trên, trái", "Thanh trên, trái", "Đảo trái", "Đầu sidebar", "Thanh trên, trái"]],
  ["Hoàn tác · Làm lại · Nhân bản · Xoá · Tự sắp xếp · Vừa khung", ["Thanh trên, phải", "Thanh trên, phải", "Đảo giữa", "Hàng nút trong sidebar", "Thanh trên, phải"]],
  ["BPMN properties · issues · Native · Markdown · Import", ["Thanh trên, phải", "Menu “…”", "Đảo giữa", "Hàng nút trong sidebar", "Thanh trên, phải"]],
  ["Export · Lưu & đóng", ["Thanh trên, phải", "Thanh trên, phải", "Đảo phải", "Chân sidebar", "Thanh trên, phải"]],
  ["Thanh công cụ: Chọn · Kéo · Giãn (S) · Mũi tên · hình · Sơ đồ khác", ["Trái canvas, dọc", "Trái canvas, dọc", "Đáy giữa, ngang", "Trái khung, dọc", "Trái canvas, dọc"]],
  ["Bảng Thuộc tính", ["Nổi phải, bấm nút mở", "Neo phải, tự mở khi chọn", "Nổi phải, bấm nút mở", "Trượt vào khi chọn", "Nổi phải, bấm nút mở"]],
  ["Thanh ngữ cảnh · mũi tên · chọn nhiều · menu chuột phải · menu làn", ["Trên phần tử", "Trên phần tử", "Trên phần tử", "Trên phần tử", "Trên phần tử"]],
  ["Tìm phần tử (lệnh) · breadcrumb quy trình con", ["Trên canvas", "Trên canvas", "Trên canvas", "Trên canvas", "Trên canvas"]],
  ["Zoom · gợi ý thao tác · minimap", ["Đáy canvas", "Dải đáy phẳng", "Đáy trái · ẩn gợi ý · minimap phải", "Đáy khung", "Đáy canvas"]],
  ["Danh sách lỗi BPMN", ["Leaf phải của Obsidian", "Tab trong sidebar trái", "Leaf phải của Obsidian", "Mục trong sidebar", "Leaf phải của Obsidian"]],
  ["Mới (chưa có trong plugin)", ["—", "Cây Pool → Làn → Bước", "—", "Không gian theo làn, bấm là lướt tới", "Văn bản quy trình chỉ đọc, đồng bộ chọn"]],
];
const bar = h("div", "p-switch", `<button data-d="-1">${iconSvg("chevron-left")}</button><span class="p-sw-name"><b>${v.key}</b> ${v.name}</span><button data-d="1">${iconSvg("chevron-right")}</button><i></i><button class="p-sw-map">${iconSvg("table")}<span>Đối chiếu</span></button>`);
document.body.appendChild(bar);
bar.onclick = (e) => {
  const t = e.target as HTMLElement;
  const d = t.closest<HTMLElement>("[data-d]")?.dataset.d; if (d) return go(+d);
  if (!t.closest(".p-sw-map")) return;
  const old = document.querySelector(".p-map"); if (old) return old.remove();
  const ci = VARIANTS.indexOf(v);
  document.body.appendChild(h("div", "p-map", `<table><thead><tr><th>Tính năng có sẵn → nằm ở đâu</th>${VARIANTS.map((x, i) => `<th class="${i === ci ? "on" : ""}">${x.key} · ${x.name}</th>`).join("")}</tr></thead><tbody>${
    MAP.map(([f, w]) => `<tr><td>${f}</td>${w.map((c, i) => `<td class="${i === ci ? "on" : ""}">${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`));
};
document.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input,textarea,[contenteditable]")) return;
  if (e.altKey && e.key === "ArrowLeft") go(-1);
  if (e.altKey && e.key === "ArrowRight") go(1);
});

const root = h("div", `p-root v-${v.key}`); app.replaceChildren(root);
document.body.dataset.variant = v.key;
current = v.build(root);
graph.on("selection:changed", () => current?.onSel?.());
(window as any).__proto = { canvas, graph, go };
(async () => {
  try { const r = await fetch("./prototype-board.local.json", { cache: "reload" }); if (r.ok) canvas.loadModel(await r.json()); } catch { /* không có board thật */ }
  requestAnimationFrame(() => {
    graph.resize(); refresh();
    const saved = sessionStorage.getItem("proto-view");
    if (saved) { const { s, t } = JSON.parse(saved); graph.zoomTo(s); graph.translate(t.tx, t.ty); } else graph.zoomToFit({ padding: 40, maxScale: 1 });
    cv.updateZoom?.(); current?.onSel?.();
  });
})();
