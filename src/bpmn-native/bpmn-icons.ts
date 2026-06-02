import { addIcon } from "obsidian";

/**
 * Obsidian's addIcon wraps registered icons in a <svg viewBox="0 0 100 100"> tag.
 * To make our 24x24 coordinate designs scale perfectly to Obsidian's standard 100x100 icon box,
 * we wrap the inner elements inside a <g transform="scale(4.167)"> group.
 */
const svgWrap = (content: string) =>
  `<g transform="scale(4.167)">${content}</g>`;

/**
 * Register high-fidelity visual shape representations of all BPMN 2.0 element types.
 * This registers custom SVG icons inside Obsidian's global icon registry so they can
 * be displayed natively in any Obsidian Menu, dropdown, or command.
 */
export function registerBpmnIcons(): void {
  const icons: Record<string, string> = {
    // --- TASKS ---
    "bpmn-task": svgWrap(`<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>`),
    "bpmn-user-task": svgWrap(`<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 9.5a2 2 0 100-4 2 2 0 000 4zM7.5 15.5c0-2 2-3 4.5-3s4.5 1 4.5 3" stroke="currentColor" stroke-width="2" fill="none"/>`),
    "bpmn-service-task": svgWrap(`<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 8.5v1M12 14.5v1M8.5 12h1M14.5 12h1" stroke="currentColor" stroke-width="2"/>`),
    "bpmn-script-task": svgWrap(`<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
    "bpmn-business-rule-task": svgWrap(`<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 8h10M7 12h10M7 16h10M11 8v8" stroke="currentColor" stroke-width="1.5"/>`),
    "bpmn-send-task": svgWrap(`<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 9l6 3.5 6-3.5M6 15V9h12v6z" stroke="currentColor" stroke-width="1.5" fill="none"/>`),
    "bpmn-receive-task": svgWrap(`<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 9l6 3 6-3M6 15l4.5-3M18 15l-4.5-3" stroke="currentColor" stroke-width="1.5" fill="none"/>`),
    "bpmn-manual-task": svgWrap(`<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 15c0-1.5 1-2.5 2.5-2.5s2.5 1 2.5 2.5M11 15c0-1.5 1-2.5 2.5-2.5s2.5 1 2.5 2.5M16 15c0-1.5 1-2.5 2.5-2.5s2.5 1 2.5 2.5" stroke="currentColor" stroke-width="1.5"/>`),
    "bpmn-call-activity": svgWrap(`<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="3.5"/>`),
    "bpmn-sub-process": svgWrap(`<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="10" y="13" width="4" height="4" fill="none" stroke="currentColor" stroke-width="1"/><path d="M12 14v2M11 15h2" stroke="currentColor" stroke-width="1"/>`),
    "bpmn-transaction": svgWrap(`<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="5" y="7" width="14" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1"/>`),
    "bpmn-event-sub-process": svgWrap(`<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2,2"/><circle cx="7" cy="9" r="2.5" stroke="currentColor" stroke-width="1" fill="none"/>`),
    
    // --- GATEWAYS ---
    "bpmn-gateway-xor": svgWrap(`<path d="M12 2l9 10-9 10-9-10z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
    "bpmn-gateway-and": svgWrap(`<path d="M12 2l9 10-9 10-9-10z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v10M7 12h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
    "bpmn-gateway-or": svgWrap(`<path d="M12 2l9 10-9 10-9-10z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.5" stroke="currentColor" stroke-width="2" fill="none"/>`),
    "bpmn-gateway-complex": svgWrap(`<path d="M12 2l9 10-9 10-9-10z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v10M7 12h10M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="currentColor" stroke-width="1.5"/>`),
    "bpmn-gateway-event": svgWrap(`<path d="M12 2l9 10-9 10-9-10z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="1" fill="none"/><circle cx="12" cy="12" r="3.5" stroke="currentColor" stroke-width="1" fill="none"/><polygon points="12,10 13.5,11 13,13 11,13 10.5,11" stroke="currentColor" stroke-width="1" fill="none"/>`),
    
    // --- EVENTS ---
    "bpmn-start-event": svgWrap(`<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.5"/>`),
    "bpmn-catch-event": svgWrap(`<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="1"/>`),
    "bpmn-throw-event": svgWrap(`<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="2"/>`),
    "bpmn-boundary-event": svgWrap(`<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2,2"/><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="1"/>`),
    "bpmn-end-event": svgWrap(`<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="3"/>`),
    
    // --- DATA & OTHERS ---
    "bpmn-data-object": svgWrap(`<path d="M7 3h6.5l4.5 4.5V21H7z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13.5 3v4.5H18" stroke="currentColor" stroke-width="2"/>`),
    "bpmn-data-store": svgWrap(`<ellipse cx="12" cy="6" rx="6" ry="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 6v6c0 1.5 2.7 2.5 6 2.5s6-1 6-2.5V6M6 12v6c0 1.5 2.7 2.5 6 2.5s6-1 6-2.5v-6" fill="none" stroke="currentColor" stroke-width="2"/>`),
    "bpmn-data-input": svgWrap(`<path d="M7 3h6.5l4.5 4.5V21H7z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13.5 3v4.5H18" stroke="currentColor" stroke-width="2"/><path d="M10 12h4m-2-2v4" stroke="currentColor" stroke-width="1.5"/>`),
    "bpmn-data-output": svgWrap(`<path d="M7 3h6.5l4.5 4.5V21H7z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13.5 3v4.5H18" stroke="currentColor" stroke-width="2"/><path d="M10 13h4" stroke="currentColor" stroke-width="1.5"/>`),
    "bpmn-participant": svgWrap(`<rect x="3" y="4" width="18" height="16" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 4v16" stroke="currentColor" stroke-width="2"/>`),
    "bpmn-lane": svgWrap(`<rect x="3" y="6" width="18" height="12" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 6h6v12H3z" stroke="currentColor" stroke-width="1.5"/>`),
    "bpmn-group": svgWrap(`<rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4,3"/>`),
    "bpmn-text-annotation": svgWrap(`<path d="M9 4H5v16h4" fill="none" stroke="currentColor" stroke-width="2"/>`)
  };

  for (const [id, svgContent] of Object.entries(icons)) {
    addIcon(id, svgContent);
  }
}
