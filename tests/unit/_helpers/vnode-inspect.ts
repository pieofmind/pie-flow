/**
 * Shared VNode inspection helpers for Preact component unit tests.
 *
 * Tests in this project avoid DOM dependencies (jsdom / happy-dom) — the
 * skeleton/sidebar components are pure functions returning VNode trees, and
 * we inspect those trees directly. This keeps the test setup zero-config and
 * fast.
 *
 * If a future component genuinely requires DOM behavior (hooks, effects,
 * focus management), prefer adding a dedicated integration test file with
 * happy-dom rather than smuggling DOM into these helpers.
 */

/**
 * Preact VNode shape (subset). Using a loose structural type keeps the
 * helpers resilient if Preact bumps minor internals — we only assert what
 * the public contract promises (type, props.class, props.children,
 * data-* attributes).
 */
export interface InspectableVNode {
  type: string | unknown;
  props: {
    class?: string;
    "data-testid"?: string;
    children?: unknown;
    [otherProp: string]: unknown;
  };
}

/** Cast an unknown (typically a JSX expression result) to the inspect shape. */
export function asVNode(value: unknown): InspectableVNode {
  return value as InspectableVNode;
}

/**
 * Normalize the `props.children` slot into an array of VNodes. Filters out
 * primitives, `null`, `undefined`, and `false`, and recursively flattens
 * nested arrays (which Preact emits when JSX contains `array.map(...)` inside
 * another mapping or alongside conditional `{cond && <X/>}`).
 *
 * The result is guaranteed to contain only VNode-shaped objects: each entry
 * has a `props` object (per Preact's `h()` invariant), so consumer code like
 * `findByTestId` can safely read `entry.props.<key>`.
 */
export function childrenArray(vnode: InspectableVNode): InspectableVNode[] {
  if (!vnode || !vnode.props) return [];
  const out: InspectableVNode[] = [];
  const walk = (c: unknown): void => {
    if (c == null || c === false || c === true) return;
    if (Array.isArray(c)) {
      for (const inner of c) walk(inner);
      return;
    }
    if (typeof c !== "object") return; // primitives (string / number)
    // At this point `c` is an object — assume VNode shape. Defensive:
    // require a `props` field before accepting (real Preact VNodes always
    // have one, but a stray non-VNode object would fail downstream).
    const v = c as InspectableVNode;
    if (v.props === undefined) return;
    out.push(v);
  };
  walk(vnode.props.children);
  return out;
}

/**
 * Recursive search by `data-testid`. Returns the first match or undefined.
 */
export function findByTestId(
  vnode: InspectableVNode,
  testId: string,
): InspectableVNode | undefined {
  if (vnode.props["data-testid"] === testId) return vnode;
  for (const child of childrenArray(vnode)) {
    const hit = findByTestId(child, testId);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Recursive collect — returns all VNodes matching a predicate. Useful for
 * counting items (e.g., "how many palette buttons rendered?").
 */
export function collectAll(
  vnode: InspectableVNode,
  predicate: (v: InspectableVNode) => boolean,
): InspectableVNode[] {
  const out: InspectableVNode[] = [];
  if (predicate(vnode)) out.push(vnode);
  for (const child of childrenArray(vnode)) {
    out.push(...collectAll(child, predicate));
  }
  return out;
}
