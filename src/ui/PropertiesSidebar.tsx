import { type VNode } from "preact";
import type {
  PropertyFieldSchema,
  PropertyFieldText,
  PropertyFieldSelect,
  PropertyFieldToggle,
} from "../core/sidebarSchema";

const DEFAULT_EMPTY_TEXT =
  "Chọn một phần tử trên canvas để chỉnh nội dung, màu và vị trí.";

/**
 * Render threshold: select fields with up to `INLINE_SELECT_LIMIT` options
 * render as horizontal segmented buttons (matching the Claude Design "LR | TB"
 * pattern). More options → dropdown.
 */
const INLINE_SELECT_LIMIT = 3;

export interface PropertiesSidebarProps {
  /** Section title (e.g., `"Diagram"`, `"Task"`). When undefined and `fields` empty → full empty state. */
  sectionTitle?: string;
  /** Optional chip beside the title (e.g., adapter id `"bpmn"`). */
  sectionSubtitle?: string;
  /** Schema-driven fields. Empty array → empty state body (header may still render if `sectionTitle` is set). */
  fields: ReadonlyArray<PropertyFieldSchema>;
  /** Override the default empty-state copy. */
  emptyStateText?: string;
}

function renderText(field: PropertyFieldText): VNode {
  return (
    <div
      class="diagrams-properties-field diagrams-properties-field-text"
      data-testid={`diagrams-properties-field-${field.key}`}
    >
      <label class="diagrams-properties-label">{field.label}</label>
      <input
        type="text"
        class="diagrams-properties-input"
        value={field.value}
        placeholder={field.placeholder}
        onInput={(e) => {
          const target = e.currentTarget as HTMLInputElement;
          field.onChange?.(target.value);
        }}
      />
    </div>
  );
}

function renderSelect(field: PropertyFieldSelect): VNode {
  const isInline = field.options.length <= INLINE_SELECT_LIMIT;
  return (
    <div
      class="diagrams-properties-field diagrams-properties-field-select"
      data-testid={`diagrams-properties-field-${field.key}`}
    >
      <label class="diagrams-properties-label">{field.label}</label>
      {isInline ? (
        <div class="diagrams-properties-segmented" role="radiogroup">
          {field.options.map((opt) => {
            const active = opt.value === field.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                class={
                  active
                    ? "diagrams-properties-segment diagrams-properties-segment-active"
                    : "diagrams-properties-segment"
                }
                onClick={() => field.onChange?.(opt.value)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      ) : (
        <select
          class="diagrams-properties-dropdown"
          value={field.value}
          onChange={(e) => {
            const target = e.currentTarget as HTMLSelectElement;
            field.onChange?.(target.value);
          }}
        >
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function renderToggle(field: PropertyFieldToggle): VNode {
  return (
    <div
      class="diagrams-properties-field diagrams-properties-field-toggle"
      data-testid={`diagrams-properties-field-${field.key}`}
    >
      <label class="diagrams-properties-label">{field.label}</label>
      <button
        type="button"
        role="switch"
        aria-checked={field.value}
        class={
          field.value
            ? "diagrams-properties-toggle diagrams-properties-toggle-on"
            : "diagrams-properties-toggle"
        }
        onClick={() => field.onChange?.(!field.value)}
      >
        <span class="diagrams-properties-toggle-thumb" />
      </button>
    </div>
  );
}

function renderField(field: PropertyFieldSchema): VNode {
  // Exhaustive narrowing — TypeScript will error if a new kind is added
  // without a branch here (caught at compile time via `never`).
  switch (field.kind) {
    case "text":
      return renderText(field);
    case "select":
      return renderSelect(field);
    case "toggle":
      return renderToggle(field);
    default: {
      const _exhaustive: never = field;
      return _exhaustive;
    }
  }
}

/**
 * Right-side properties panel in the unified `<BoardEditor>` shell.
 *
 * Renders a header (title + optional subtitle chip) and a stack of fields
 * driven by the discriminated `PropertyFieldSchema` union. When `fields` is
 * empty, an empty state with adapter-supplied or default copy is shown.
 *
 * Story 7-2 scope: pure render + change dispatch. Real adapter wiring (which
 * fields appear for which selected node) is Story 7-3 / 7-8.
 *
 * **Lifecycle:** Stateless. Caller mounts via `render()` and must call
 * `render(null, host)` on unmount.
 */
export function PropertiesSidebar(props: PropertiesSidebarProps): VNode {
  const hasFields = props.fields.length > 0;
  const showHeader = !!props.sectionTitle;

  return (
    <aside
      class="diagrams-properties-sidebar"
      data-testid="diagrams-properties-sidebar"
    >
      {showHeader && (
        <header
          class="diagrams-properties-header"
          data-testid="diagrams-properties-header"
        >
          <span class="diagrams-properties-title">{props.sectionTitle}</span>
          {props.sectionSubtitle && (
            <span class="diagrams-properties-subtitle">
              {props.sectionSubtitle}
            </span>
          )}
        </header>
      )}
      {hasFields ? (
        <div
          class="diagrams-properties-body"
          data-testid="diagrams-properties-body"
        >
          {props.fields.map((field) => renderField(field))}
        </div>
      ) : (
        <div
          class="diagrams-properties-empty"
          data-testid="diagrams-properties-empty"
        >
          {props.emptyStateText ?? DEFAULT_EMPTY_TEXT}
        </div>
      )}
    </aside>
  );
}

export default PropertiesSidebar;
