/**
 * Who does a BPMN step and with which skill — the chips the Board draws on a
 * task (Pie Squad ADR 0001: lane = agent, camunda:assignee = per-step owner,
 * camunda:property name="skill" = skill, approval gate = the owner's lane or a
 * userTask done by someone who is not an agent).
 */
import type { PoolLaneExtra } from "./htmlNode";

export interface SquadAgent { name: string; skills: string[] }
/** What Pie Squad tells us; null = not installed / other API version. */
export interface SquadInfo { owner: string | null; agents: SquadAgent[] }
export interface StepData {
  kind?: string;
  camunda?: Record<string, string>;
  bpmnProps?: Array<{ name: string; value: string }>;
  laneId?: string;
}
export interface StepChips {
  /** agent: name matches a Pie Squad agent; undefined without Pie Squad (plain chip). */
  who?: { name: string; agent?: boolean; approve: boolean };
  skills: Array<{ name: string; missing?: string }>;
}

function laneLabel(lanes: readonly PoolLaneExtra[], id: string): string | undefined {
  for (const ln of lanes) {
    if (ln.id === id) return ln.label;
    const hit = ln.lanes ? laneLabel(ln.lanes, id) : undefined;
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** Who does the step: its own camunda:assignee, else the label of the lane it sits in. */
export function stepWho(d: StepData, poolLanes: readonly PoolLaneExtra[] | undefined, squad: SquadInfo | null): StepChips["who"] {
  const assignee = d.camunda?.assignee?.trim();
  const lane = !assignee && d.laneId && poolLanes ? laneLabel(poolLanes, d.laneId)?.trim() : undefined;
  const name = assignee || lane;
  if (!name) return undefined;
  if (!squad) return { name, approve: false };
  const agent = squad.agents.some((a) => a.name === name);
  return { name, agent, approve: name === squad.owner || (d.kind === "bpmn-task-user" && !agent) };
}

export function stepChips(d: StepData, poolLanes: readonly PoolLaneExtra[] | undefined, squad: SquadInfo | null): StepChips {
  const who = stepWho(d, poolLanes, squad);
  const agent = who && squad?.agents.find((a) => a.name === who.name);
  const skills = skillsOf(d.bpmnProps)
    .map((s) => (agent && !agent.skills.includes(s) ? { name: s, missing: `${agent.name} chưa có skill này` } : { name: s }));
  return { who, skills };
}

type Prop = { name: string; value: string };
/** The step's skills (camunda:property name="skill"), in order. */
export const skillsOf = (props: readonly Prop[] | undefined): string[] =>
  (props ?? []).filter((p) => p.name === "skill" && p.value?.trim()).map((p) => p.value.trim());

/** Replace the skill properties with `skills`, in place of the first one (or at the end); other properties untouched. */
export function withSkills(props: readonly Prop[] | undefined, skills: readonly string[]): Prop[] {
  const list = props ?? [];
  const at = list.findIndex((p) => p.name === "skill");
  const rest = list.filter((p) => p.name !== "skill");
  const pos = at < 0 ? rest.length : list.slice(0, at).filter((p) => p.name !== "skill").length;
  return [...rest.slice(0, pos), ...skills.map((value) => ({ name: "skill", value })), ...rest.slice(pos)];
}

/** Skills to offer: the step's agent's skills first, then every other agent's; minus the ones already picked. */
export function skillSuggestions(squad: SquadInfo | null, agent: string | undefined, picked: readonly string[]): string[] {
  if (!squad) return [];
  const own = squad.agents.find((a) => a.name === agent)?.skills ?? [];
  return [...new Set([...own, ...squad.agents.flatMap((a) => a.skills)])].filter((s) => !picked.includes(s));
}

/** Names to offer when naming a lane: the owner (approval lane) then each agent. Empty without Pie Squad. */
export function laneNameSuggestions(squad: SquadInfo | null): string[] {
  return squad ? [...new Set([...(squad.owner ? [squad.owner] : []), ...squad.agents.map((a) => a.name)])] : [];
}

/** Pie Squad's public API v1 (pie-squad plugin/src/api.js) — read at runtime, never imported. */
export interface PieSquadApi { version: number; owner(): string | null; agents(): unknown; onChange(cb: () => void): unknown }
export function pieSquadApi(): PieSquadApi | null {
  const api = (globalThis as { app?: { plugins?: { plugins?: Record<string, { api?: PieSquadApi }> } } })
    .app?.plugins?.plugins?.["pie-squad"]?.api;
  return api?.version === 1 ? api : null;
}
/** Pie Squad's owner + agents, validated (bad agent entries dropped); null when absent or broken. */
export function readSquad(api = pieSquadApi()): SquadInfo | null {
  if (!api) return null;
  try {
    const owner = api.owner(), raw = api.agents();
    if (!Array.isArray(raw)) throw new Error("agents() is not an array");
    const agents = raw.flatMap((a: Partial<SquadAgent> | null) =>
      typeof a?.name === "string" && Array.isArray(a.skills) && a.skills.every((s) => typeof s === "string")
        ? [{ name: a.name, skills: [...a.skills] }] : []);
    return { owner: typeof owner === "string" ? owner : null, agents };
  } catch (e) { console.error("[omniboard] pie-squad api", e); return null; }
}
/** Subscribe to Pie Squad's change signal; a missing or throwing API gives a no-op unsubscribe. */
export function onSquadChange(api: PieSquadApi | null, cb: () => void): () => void {
  try {
    const off = api?.onChange(cb);
    if (typeof off === "function") return () => { try { off(); } catch (e) { console.error("[omniboard] pie-squad off", e); } };
  } catch (e) { console.error("[omniboard] pie-squad onChange", e); }
  return () => {};
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Most chips in the skill row, "+n" included. */
const MAX_SKILL_CHIPS = 2;

export function stepChipsHtml(c: StepChips): string {
  const who = c.who
    ? `<span class="bp-who${c.who.approve ? " is-approve" : c.who.agent ? " is-agent" : c.who.agent === false ? " is-faint" : ""}" title="${esc(c.who.name)}">`
      + `<span class="bp-ava">${esc([...c.who.name][0]?.toUpperCase() ?? "")}</span>${c.who.approve ? "duyệt" : esc(c.who.name)}</span>`
    : "";
  const chip = (text: string, title: string, missing: boolean, more = false) =>
    `<span class="bp-skill${missing ? " is-missing" : ""}${more ? " is-more" : ""}" title="${esc(title)}">${esc(text)}</span>`;
  // One row only (never taller than the box): the rest fold into a "+n" chip.
  const shown = c.skills.length > MAX_SKILL_CHIPS ? c.skills.slice(0, MAX_SKILL_CHIPS - 1) : c.skills;
  const hidden = c.skills.slice(shown.length);
  const more = hidden.length
    ? chip(`+${hidden.length}`, hidden.map((s) => (s.missing ? `${s.name} (${s.missing})` : s.name)).join("\n"), hidden.some((s) => s.missing), true)
    : "";
  const skills = c.skills.length
    ? `<span class="bp-skills">${shown.map((s) => chip(s.name, s.missing ?? s.name, !!s.missing)).join("")}${more}</span>`
    : "";
  return who + skills;
}
