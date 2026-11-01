import { afterEach, describe, it, expect, vi } from "vitest";
import { laneNameSuggestions, onSquadChange, pieSquadApi, readSquad, skillSuggestions, skillsOf, withSkills, stepChips, stepChipsHtml, stepWho } from "./stepChips";
import { nodeHtml } from "./htmlNode";

const lanes = [
  { id: "nguyen", label: "Nguyên" },
  { id: "grp", label: "Nhóm", lanes: [{ id: "ve", label: "Video Editor" }] },
];
const squad = { owner: "Nguyên", agents: [{ name: "Video Editor", skills: ["pom-reel"] }, { name: "Copywriter", skills: [] }] };

describe("stepChips", () => {
  it("lấy người làm từ lane (kể cả lane con) khi không có assignee", () => {
    expect(stepChips({ laneId: "ve" }, lanes, squad).who).toEqual({ name: "Video Editor", agent: true, approve: false });
  });
  it("assignee thắng lane", () => {
    expect(stepChips({ laneId: "ve", camunda: { assignee: "Copywriter" } }, lanes, squad).who)
      .toEqual({ name: "Copywriter", agent: true, approve: false });
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
    expect(c).toEqual({ who: { name: "Nguyên", approve: false }, skills: [{ name: "a" }] });
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
  it("không assignee: tên lane", () => {
    expect(stepWho({ laneId: "ve", camunda: { assignee: " " } }, lanes, null)).toEqual({ name: "Video Editor", approve: false });
  });
  it("có assignee: tên riêng", () => {
    expect(stepWho({ laneId: "ve", camunda: { assignee: "Copywriter" } }, lanes, null)?.name).toBe("Copywriter");
  });
  it("không lane, không assignee: không có ai", () => {
    expect(stepWho({ laneId: "khong-co" }, lanes, null)).toBeUndefined();
  });
});

describe("chip trên bản xuất tĩnh", () => {
  it("renderModelToSvg có chip người làm và skill trong ô task", async () => {
    const { renderModelToSvg } = await import("./staticRender");
    const svg = renderModelToSvg({ edges: [], nodes: [
      { id: "p", shape: "bpmn-pool", x: 0, y: 0, width: 600, height: 200, label: "Pool", attrs: { lanes } },
      { id: "t", shape: "bpmn-task", x: 50, y: 50, width: 100, height: 80, label: "Dựng", laneId: "ve",
        attrs: { bpmnProps: [{ name: "skill", value: "pom-reel" }] } },
      { id: "g", shape: "bpmn-gateway-x", x: 200, y: 50, width: 40, height: 40, label: "", laneId: "ve" },
    ] }, "");
    expect(svg).toMatch(/class="bp-task">Dựng<span class="bp-who"[^]*Video Editor[^]*bp-skill[^>]*>pom-reel<\/span><\/span><\/div>/);
    expect(svg.match(/bp-who/g)).toHaveLength(1);
  });
});

describe("giới hạn chip skill", () => {
  const sk = (...names: string[]) => ({ skills: names.map((name) => ({ name })) });
  it("2 skill: hiện đủ cả hai", () => {
    const h = stepChipsHtml(sk("pom-reel", "pom-reel-review"));
    expect(h.match(/class="bp-skill"/g)).toHaveLength(2);
    expect(h).not.toContain("+");
  });
  it("4 skill: 1 chip + \"+3\", title liệt kê phần ẩn", () => {
    const h = stepChipsHtml({ skills: [{ name: "a" }, { name: "b" }, { name: "c", missing: "X chưa có skill này" }, { name: "d" }] });
    expect(h).toContain(">a<");
    expect(h).toContain('class="bp-skill is-missing is-more" title="b\nc (X chưa có skill này)\nd">+3<');
  });
});

describe("gợi ý tên lane", () => {
  it("chủ trước, rồi các agent; không Pie Squad thì rỗng", () => {
    expect(laneNameSuggestions(squad)).toEqual(["Nguyên", "Video Editor", "Copywriter"]);
    expect(laneNameSuggestions(null)).toEqual([]);
  });
});

describe("ô Skill trong bảng Thuộc tính", () => {
  const props = [{ name: "a", value: "1" }, { name: "skill", value: "x" }, { name: "b", value: "2" }, { name: "skill", value: "y" }];
  it("đọc skill theo thứ tự", () => expect(skillsOf(props)).toEqual(["x", "y"]));
  it("ghi lại skill vào chỗ skill đầu, giữ property khác", () => {
    expect(withSkills(props, ["y", "z"])).toEqual([
      { name: "a", value: "1" }, { name: "skill", value: "y" }, { name: "skill", value: "z" }, { name: "b", value: "2" },
    ]);
  });
  it("chưa có skill: thêm vào cuối; xoá hết: chỉ còn property khác", () => {
    expect(withSkills([{ name: "a", value: "1" }], ["x"])).toEqual([{ name: "a", value: "1" }, { name: "skill", value: "x" }]);
    expect(withSkills(props, [])).toEqual([{ name: "a", value: "1" }, { name: "b", value: "2" }]);
    expect(withSkills(undefined, [])).toEqual([]);
  });
  it("gợi ý skill của agent bước trước, bỏ skill đã chọn", () => {
    const sq = { owner: "N", agents: [{ name: "A", skills: ["s1"] }, { name: "B", skills: ["s2", "s1"] }] };
    expect(skillSuggestions(sq, "B", ["s1"])).toEqual(["s2"]);
    expect(skillSuggestions(sq, "A", [])).toEqual(["s1", "s2"]);
    expect(skillSuggestions(null, "A", [])).toEqual([]);
  });
});

describe("đậm / mờ / cổng duyệt", () => {
  const who = (d: Parameters<typeof stepWho>[0], sq: typeof squad | null = squad) => stepWho(d, lanes, sq);
  const cls = (d: Parameters<typeof stepWho>[0], sq: typeof squad | null = squad) =>
    stepChipsHtml({ who: who(d, sq), skills: [] }).match(/class="([^"]*)"/)![1];
  it("tên khớp agent (lane hay assignee): đậm", () => {
    expect(cls({ laneId: "ve" })).toBe("bp-who is-agent");
    expect(cls({ camunda: { assignee: "Copywriter" } })).toBe("bp-who is-agent");
  });
  it("tên không khớp agent: mờ", () => {
    expect(cls({ camunda: { assignee: "Kho" } })).toBe("bp-who is-faint");
  });
  it("không có Pie Squad: kiểu thường", () => {
    expect(cls({ camunda: { assignee: "Kho" } }, null)).toBe("bp-who");
    expect(cls({ laneId: "ve" }, null)).toBe("bp-who");
  });
  it("lane của Sếp: cổng duyệt", () => {
    expect(cls({ laneId: "nguyen" })).toBe("bp-who is-approve");
  });
  it("userTask có người làm không phải agent: cổng duyệt; là agent thì không", () => {
    expect(who({ kind: "bpmn-task-user", camunda: { assignee: "Kho" } })).toEqual({ name: "Kho", agent: false, approve: true });
    expect(who({ kind: "bpmn-task-user", laneId: "ve" })?.approve).toBe(false);
    expect(who({ kind: "bpmn-task", camunda: { assignee: "Kho" } })?.approve).toBe(false);
    expect(who({ kind: "bpmn-task-user", camunda: { assignee: "Kho" } }, null)?.approve).toBe(false);
  });
});

describe("đọc Pie Squad (readSquad / pieSquadApi)", () => {
  const g = globalThis as { app?: unknown };
  const install = (api: unknown) => { g.app = { plugins: { plugins: { "pie-squad": { api } } } }; };
  afterEach(() => { delete g.app; vi.restoreAllMocks(); });
  const api = (over: Record<string, unknown> = {}) =>
    ({ version: 1, owner: () => "Nguyên", agents: () => [{ name: "A", skills: ["s"] }], onChange: () => () => {}, ...over });

  it("không có plugin: null", () => {
    expect(pieSquadApi()).toBeNull();
    expect(readSquad()).toBeNull();
  });
  it("version khác 1: null", () => {
    install(api({ version: 2 }));
    expect(pieSquadApi()).toBeNull();
    expect(readSquad()).toBeNull();
  });
  it("api hợp lệ", () => {
    install(api());
    expect(readSquad()).toEqual({ owner: "Nguyên", agents: [{ name: "A", skills: ["s"] }] });
  });
  it("api ném lỗi hoặc agents() không phải mảng: null, không ném", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    install(api({ agents: () => { throw new Error("x"); } }));
    expect(readSquad()).toBeNull();
    install(api({ agents: () => "nope" }));
    expect(readSquad()).toBeNull();
  });
  it("bỏ agent sai dạng, owner null giữ null", () => {
    install(api({ owner: () => null, agents: () => [
      { name: "A", skills: ["s"] }, null, { name: 1, skills: [] }, { name: "B" }, { name: "C", skills: [2] }, { name: "D", skills: [] },
    ] }));
    expect(readSquad()).toEqual({ owner: null, agents: [{ name: "A", skills: ["s"] }, { name: "D", skills: [] }] });
    expect(laneNameSuggestions(readSquad())).toEqual(["A", "D"]);
  });
  it("onChange ném lỗi hoặc trả về không phải hàm: hủy đăng ký vẫn gọi được", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => onSquadChange(api({ onChange: () => { throw new Error("x"); } }) as never, () => {})()).not.toThrow();
    expect(() => onSquadChange(api({ onChange: () => 42 }) as never, () => {})()).not.toThrow();
    expect(() => onSquadChange(api({ onChange: () => () => { throw new Error("y"); } }) as never, () => {})()).not.toThrow();
    expect(() => onSquadChange(null, () => {})()).not.toThrow();
  });
});

describe("chip nằm trong HTML ô task (cả hai renderer dùng nodeHtml)", () => {
  it("nodeHtml vẽ chip từ NodeExtra.agent / skills, sau marker", () => {
    const h = nodeHtml("bpmn-task-user", "Duyệt", {}, {
      markers: ["loop"], agent: { name: "Nguyên", agent: false, approve: true }, skills: [{ name: "pom-reel" }],
    });
    expect(h).toMatch(/bp-markers[^]*<span class="bp-who is-approve"[^]*duyệt[^]*bp-skill[^>]*>pom-reel</);
    expect(nodeHtml("bpmn-task", "X", {}, {})).not.toContain("bp-who");
  });
  it("renderModelToCard (bản xem trên điện thoại) cũng có chip", async () => {
    const { renderModelToCard } = await import("./staticRender");
    const html = renderModelToCard({ edges: [], nodes: [
      { id: "p", shape: "bpmn-pool", x: 0, y: 0, width: 600, height: 200, label: "Pool", attrs: { lanes } },
      { id: "t", shape: "bpmn-task", x: 50, y: 50, width: 100, height: 80, label: "Dựng", laneId: "ve",
        attrs: { bpmnProps: [{ name: "skill", value: "pom-reel" }] } },
    ] });
    expect(html).toMatch(/bp-who[^]*Video Editor[^]*>pom-reel</);
  });
});
