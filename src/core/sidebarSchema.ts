/**
 * Sidebar schema types — shared cross-adapter contract for the unified
 * `<BoardEditor>` shell (Epic 7). Adapters use these types to declaratively
 * feed `<PaletteSidebar>` (left palette of element types) and
 * `<PropertiesSidebar>` (right form of fields for the selected node).
 *
 * Lives in `core/` (not `adapter.ts`) to avoid circular imports — adapter.ts
 * will re-export these in Story 7-6 (validate) + 7-14 (title contract).
 *
 * No runtime code in this file; types only.
 */

/**
 * One entry in `<PaletteSidebar>`.
 *
 * Story 7-2 ships the type shape and a click handler hook. Real wiring
 * (palette item drag-and-drop, X6 dispatch) lands in Story 7-3 (canvas
 * wiring) and Story 7-8 (BPMN adapter migration provides concrete items).
 */
export interface PaletteItem {
  /** Stable unique id within a single palette (e.g., `"start-event"`). */
  id: string;
  /** Short label shown under the icon (max ~12 chars works best). */
  label: string;
  /** Lucide icon name — same convention as `DiagramAdapter.icon`. */
  icon: string;
  /** Optional single-character keyboard hint (e.g., `"S"`). */
  shortcut?: string;
  /** Optional group header (e.g., `"PHẦN TỬ"`). Items sharing the same group are clustered visually. */
  group?: string;
  /**
   * Called when the user clicks/activates the palette item. Adapters wire
   * domain actions (insert node, switch tool) here. Optional in Story 7-2
   * because the harness consumer (`<BoardEditor>`) may handle activation
   * via `onSelectItem` at the sidebar level instead.
   */
  onActivate?: () => void;
}

/**
 * One field row in `<PropertiesSidebar>`. Discriminated union keyed by `kind`.
 *
 * Story 7-2 ships three kinds matching the Claude Design screenshots:
 * - `text` — single-line input (e.g., diagram title)
 * - `select` — choice between 2-3 values (e.g., layout direction LR/TB)
 * - `toggle` — on/off switch (e.g., snap-to-grid)
 *
 * Future stories may extend the union (e.g., `color`, `number`, `multi-select`).
 * Consumers must handle exhaustively — TypeScript will narrow correctly because
 * the union is closed at compile time.
 */
export type PropertyFieldSchema =
  | PropertyFieldText
  | PropertyFieldSelect
  | PropertyFieldToggle;

export interface PropertyFieldText {
  kind: "text";
  /** Stable identifier for this field (used as DOM key / data-testid suffix). */
  key: string;
  /** Visible label shown above or beside the input. */
  label: string;
  /** Current value. */
  value: string;
  /** Optional placeholder. */
  placeholder?: string;
  /** Called on every keystroke (debouncing is the consumer's responsibility). */
  onChange?: (next: string) => void;
}

export interface PropertyFieldSelect {
  kind: "select";
  key: string;
  label: string;
  /** Currently selected option's `value`. */
  value: string;
  /** Available options. Sidebar renders as segmented buttons when ≤3, as a dropdown otherwise. */
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange?: (next: string) => void;
}

export interface PropertyFieldToggle {
  kind: "toggle";
  key: string;
  label: string;
  /** Current on/off state. */
  value: boolean;
  onChange?: (next: boolean) => void;
}
