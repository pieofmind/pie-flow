import { describe, it, expect } from "vitest";
import { stepChips, stepChipsHtml, stepWho } from "./stepChips";

const lanes = [
  { id: "nguyen", label: "Nguyên" },
  { id: "grp", label: "Nhóm", lanes: [{ id: "ve", label: "Video Editor" }] },
];
const squad = { owner: "Nguyên", agents: [{ name: "Video Editor", skills: ["pom-reel"] }, { name: "Copywriter", skills: [] }] };

describe("stepChips", () => {
  it("lấy người làm từ lane (kể cả lane con) khi không có assignee", () => {
    expect(stepChips({ laneId: "ve" }, lanes, squad).who).toEqual({ name: "Video Editor", fromLane: true, approve: false });
  });
  it("assignee thắng lane", () => {
    expect(stepChips({ laneId: "ve", camunda: { assignee: "Copywriter" } }, lanes, squad).who)
      .toEqual({ name: "Copywriter", fromLane: false, approve: false });
  });
  it("lane của chủ là cổng duyệt", () => {
    expect(stepChips({ laneId: "nguyen" }, lanes, squad).who?.approve).toBe(true);
    expect(stepChipsHtml(stepChips({ laneId: "nguyen" }, lanes, squad))).toContain("duyệt");
  });
  it("skill theo thứ tự, cờ khi agent chưa có", () => {
    const c = stepChips({ laneId: "ve", bpmnProps: [
      { name: "skill", value: "pom-reel" }, { name: "property", value: "x" }, { name: "skill", value: "pom-reel-review" },
    ] }, lanes, squad);
    expect(c.skills).toEqual([{ name: "pom-reel" }, { name: "pom-reel-review", missing: "Video Editor chưa có skill này" }]);
  });
  it("không có Pie Squad: vẫn có chip, không cờ, không duyệt", () => {
    const c = stepChips({ laneId: "nguyen", bpmnProps: [{ name: "skill", value: "a" }] }, lanes, null);
    expect(c).toEqual({ who: { name: "Nguyên", fromLane: true, approve: false }, skills: [{ name: "a" }] });
  });
  it("không lane, không assignee, không skill: rỗng", () => {
    expect(stepChips({}, undefined, squad)).toEqual({ who: undefined, skills: [] });
    expect(stepChipsHtml({ skills: [] })).toBe("");
  });
  it("escape tên", () => {
    expect(stepChipsHtml(stepChips({ camunda: { assignee: "<b>" } }, undefined, null))).not.toContain("<b>");
  });
});

describe("stepWho (ô Người làm riêng)", () => {
  it("không assignee: tên lane, cờ fromLane", () => {
    expect(stepWho({ laneId: "ve", camunda: { assignee: " " } }, lanes, null)).toEqual({ name: "Video Editor", fromLane: true, approve: false });
  });
  it("có assignee: tên riêng", () => {
    expect(stepWho({ laneId: "ve", camunda: { assignee: "Copywriter" } }, lanes, null)?.fromLane).toBe(false);
  });
  it("không lane, không assignee: không có ai", () => {
    expect(stepWho({ laneId: "khong-co" }, lanes, null)).toBeUndefined();
  });
});
