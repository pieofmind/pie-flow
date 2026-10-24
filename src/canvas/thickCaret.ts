/** CSS cannot widen a caret, so draw a 2px one over a horizontal textarea:
 *  a hidden mirror with the same text metrics locates the insertion point.
 *  Returns the cleanup. */
const COPY = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "textAlign", "whiteSpace",
  "overflowWrap", "wordBreak", "boxSizing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle"] as const;

export function attachThickCaret(ta: HTMLTextAreaElement): () => void {
  const host = ta.parentElement;
  if (!host) return () => {};
  const caret = document.createElement("div");
  caret.className = "lk-thick-caret";
  host.appendChild(caret);
  ta.style.caretColor = "transparent";

  const place = () => {
    const pos = ta.selectionStart;
    if (document.activeElement !== ta || pos !== ta.selectionEnd) { caret.style.display = "none"; return; }
    const cs = getComputedStyle(ta);
    const mirror = document.createElement("div");
    COPY.forEach((k) => { mirror.style[k] = cs[k]; });
    Object.assign(mirror.style, { position: "absolute", visibility: "hidden", left: "0", top: "0", width: cs.width, borderColor: "transparent" });
    const mark = document.createElement("span");
    mark.textContent = "​";
    mirror.append(ta.value.slice(0, pos), mark, ta.value.slice(pos) || "​");
    host.appendChild(mirror);
    const h = mark.offsetHeight;
    Object.assign(caret.style, {
      display: "block", height: h + "px",
      left: ta.offsetLeft + mark.offsetLeft - ta.scrollLeft - 1 + "px",
      top: ta.offsetTop + mark.offsetTop - ta.scrollTop + "px",
    });
    mirror.remove();
    caret.style.animation = "none"; void caret.offsetWidth; caret.style.animation = ""; // restart blink on move
  };
  const later = () => setTimeout(place, 0); // after the key/click has moved the selection
  const events = ["input", "keydown", "keyup", "mousedown", "mouseup", "focus", "blur", "select", "scroll"];
  events.forEach((ev) => ta.addEventListener(ev, later));
  document.addEventListener("selectionchange", later);
  setTimeout(place, 20);
  return () => {
    events.forEach((ev) => ta.removeEventListener(ev, later));
    document.removeEventListener("selectionchange", later);
    caret.remove();
  };
}
