/** Which event triggers BPMN 2.0 allows where (tables 10.93 start, 10.94 end,
 *  10.95 intermediate / boundary), and whether an intermediate event throws. */

type EventAttrs = { trigger?: string; throwing?: boolean; attachedTo?: string };

// Start also lists error / escalation / compensation: allowed inside an event sub-process.
const START = ["none", "message", "timer", "conditional", "signal", "multiple", "parallel-multiple", "error", "escalation", "compensation"];
const END = ["none", "message", "escalation", "error", "cancel", "compensation", "signal", "terminate", "multiple"];
const CATCH = ["none", "message", "timer", "conditional", "link", "signal", "multiple", "parallel-multiple"];
const THROW = ["none", "message", "escalation", "link", "compensation", "signal", "multiple"];
const BOUNDARY = ["message", "timer", "escalation", "conditional", "error", "cancel", "signal", "compensation", "multiple", "parallel-multiple"];

const THROW_ONLY = new Set(["escalation", "compensation"]);
const CATCH_ONLY = new Set(["timer", "conditional", "parallel-multiple"]);

/** Triggers offered for an event shape ("none" = a plain event). */
export function allowedTriggers(kind: string, attrs: EventAttrs): string[] {
  if (kind === "bpmn-event-start") return START;
  if (kind === "bpmn-event-end") return END;
  if (attrs.attachedTo) return BOUNDARY;
  return attrs.throwing === true ? THROW : CATCH;
}

/** An intermediate event throws when it has no trigger (a plain one), when its
 *  trigger can only be thrown, or when the Board marks it throwing — and never
 *  with a trigger that can only be caught. */
export function isThrowingEvent(attrs: EventAttrs): boolean {
  const t = attrs.trigger && attrs.trigger !== "none" ? attrs.trigger : undefined;
  if (!t || THROW_ONLY.has(t)) return true;
  if (CATCH_ONLY.has(t)) return false;
  return attrs.throwing === true;
}

/** Picker options: the allowed triggers, plus the current one if a file brought
 *  in a combination the table forbids (so opening the picker never drops it). */
export function triggerChoices(kind: string, attrs: EventAttrs): string[] {
  const allowed = allowedTriggers(kind, attrs);
  const cur = attrs.trigger;
  return cur && !allowed.includes(cur) ? [...allowed, cur] : allowed;
}
