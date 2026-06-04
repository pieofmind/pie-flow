import { type VNode } from "preact";
import type { PaletteSidebarItem } from "../core/sidebarSchema";

/**
 * Props for `<PaletteSidebar>`.
 *
 * The sidebar is **controlled**: `selectedId` is owned by the parent
 * (`<BoardEditor>`) so multiple sidebars/keyboard shortcuts can keep state in
 * sync without internal `useState`. This also keeps the component P5-clean —
 * no module-level mutable state, no useState in stateless wrappers.
 */
export interface PaletteSidebarProps {
  /** Items to render. Pass `[]` to render an empty palette frame. */
  items: ReadonlyArray<PaletteSidebarItem>;
  /** Id of the currently active item (cursor mode, selected tool). */
  selectedId?: string;
  /**
   * Called when the user clicks an item. The parent should typically update
   * `selectedId` in response. `item.onActivate?.()` is fired in addition,
   * AFTER this callback, so adapters can dispatch domain actions.
   */
  onSelectItem?: (id: string) => void;
}

/**
 * Group items in insertion order while preserving the first appearance
 * order of each group label. Returns an array of `{ group, items }` so the
 * renderer can emit headers in a stable sequence.
 */
function groupItems(
  items: ReadonlyArray<PaletteSidebarItem>,
): Array<{ group: string | undefined; items: PaletteSidebarItem[] }> {
  const order: Array<string | undefined> = [];
  const buckets = new Map<string | undefined, PaletteSidebarItem[]>();
  for (const item of items) {
    const key = item.group;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(item);
  }
  return order.map((group) => ({ group, items: buckets.get(group)! }));
}

/**
 * Left-side palette in the unified `<BoardEditor>` shell.
 *
 * Renders a vertical stack of clickable items. Each item shows an icon
 * placeholder (real Lucide injection lands in Story 7-3 via Obsidian's
 * `setIcon()` — requires Obsidian API access we don't have at this layer),
 * a label, and an optional keyboard shortcut hint.
 *
 * Story 7-2 scope: pure render + click dispatch. Drag-and-drop to canvas is
 * Story 7-3; keyboard shortcuts (V/S/T/G/E/P/F per Claude Design) are
 * Story 7-3 as well.
 *
 * **Lifecycle:** Stateless. Caller mounts via `render(h(PaletteSidebar, props), host)`
 * and must call `render(null, host)` on unmount (see BoardEditor.tsx JSDoc).
 */
export function PaletteSidebar(props: PaletteSidebarProps): VNode {
  const groups = groupItems(props.items);

  return (
    <aside
      class="diagrams-palette-sidebar"
      data-testid="diagrams-palette-sidebar"
    >
      {groups.map(({ group, items }) => (
        <div class="diagrams-palette-group" key={group || "__ungrouped"}>
          {/* Empty-string group is treated as "no group" (no header rendered) */}
          {group !== undefined && group.length > 0 && (
            <div class="diagrams-palette-group-header">{group}</div>
          )}
          {items.map((item) => {
            const isSelected = props.selectedId === item.id;
            const itemClass = isSelected
              ? "diagrams-palette-item diagrams-palette-item-selected"
              : "diagrams-palette-item";
            return (
              <button
                key={item.id}
                type="button"
                class={itemClass}
                data-testid={`diagrams-palette-item-${item.id}`}
                // `aria-current="true"` is the correct ARIA pattern for
                // single-selection "active tool" semantics. `aria-pressed`
                // (used previously) is for toggle buttons and causes screen
                // readers to announce all non-selected items as "not pressed".
                aria-current={isSelected ? "true" : undefined}
                onClick={() => {
                  props.onSelectItem?.(item.id);
                  item.onActivate?.();
                }}
              >
                <span
                  class="diagrams-palette-icon"
                  data-icon={item.icon}
                  aria-hidden="true"
                />
                <span class="diagrams-palette-label">{item.label}</span>
                {item.shortcut && (
                  <span class="diagrams-palette-shortcut">
                    {item.shortcut}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );
}

export default PaletteSidebar;
