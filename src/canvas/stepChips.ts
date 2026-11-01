/**
 * Who does a BPMN step and with which skill — the chips the Board draws on a
 * task (Pie Squad ADR 0001: lane = agent, camunda:assignee = per-step owner,
 * camunda:property name="skill" = skill, the owner's lane = approval gate).
 */
import type { PoolLaneExtra } from "./htmlNode";

export interface SquadAgent { name: string; skills: string[] }
/** What Pie Squad tells us; null = not installed / other API version. */
export interface SquadInfo { owner: string; agents: SquadAgent[] }
export interface StepData {
  camunda?: Record<string, string>;
  bpmnProps?: Array<{ name: string; value: string }>;
  laneId?: string;
}
export interface StepChips {
  who?: { name: string; fromLane: boolean; approve: boolean };
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
  return name ? { name, fromLane: !assignee, approve: !!squad && name === squad.owner } : undefined;
}

export function stepChips(d: StepData, poolLanes: readonly PoolLaneExtra[] | undefined, squad: SquadInfo | null): StepChips {
  const who = stepWho(d, poolLanes, squad);
  const agent = who && squad?.agents.find((a) => a.name === who.name);
  const skills = (d.bpmnProps ?? [])
    .filter((p) => p.name === "skill" && p.value?.trim())
    .map((p) => {
      const s = p.value.trim();
      return agent && !agent.skills.includes(s) ? { name: s, missing: `${agent.name} chưa có skill này` } : { name: s };
    });
  return { who, skills };
}

/** Pie Squad's public API v1 (pie-squad plugin/src/api.js) — read at runtime, never imported. */
export interface PieSquadApi { version: number; owner(): string; agents(): SquadAgent[]; onChange(cb: () => void): () => void }
export function pieSquadApi(): PieSquadApi | null {
  const api = (globalThis as { app?: { plugins?: { plugins?: Record<string, { api?: PieSquadApi }> } } })
    .app?.plugins?.plugins?.["pie-squad"]?.api;
  return api?.version === 1 ? api : null;
}
export function readSquad(): SquadInfo | null {
  const api = pieSquadApi();
  if (!api) return null;
  try { return { owner: String(api.owner()), agents: api.agents() }; }
  catch (e) { console.error("[omniboard] pie-squad api", e); return null; }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function stepChipsHtml(c: StepChips): string {
  const who = c.who
    ? `<span class="bp-who${c.who.fromLane ? " is-lane" : ""}${c.who.approve ? " is-approve" : ""}" title="${esc(c.who.name)}">`
      + `<span class="bp-ava">${esc([...c.who.name][0]?.toUpperCase() ?? "")}</span>${c.who.approve ? "duyệt" : esc(c.who.name)}</span>`
    : "";
  const skills = c.skills.length
    ? `<span class="bp-skills">${c.skills.map((s) => `<span class="bp-skill${s.missing ? " is-missing" : ""}" title="${esc(s.missing ?? s.name)}">${esc(s.name)}</span>`).join("")}</span>`
    : "";
  return who + skills;
}
