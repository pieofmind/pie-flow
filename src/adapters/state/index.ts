import { makeStubAdapter } from "../makeStubAdapter";

export const stateAdapter = makeStubAdapter({
  id: "state",
  displayName: "State Machine",
  codeBlockLanguage: "state",
  icon: "circle-dot",
  template: `---
positions:
  Draft: [100, 100]
  Submitted: [300, 100]
---
stateDiagram-v2
  [*] --> Draft
  Draft --> Submitted: submit
  Submitted --> Draft: reject`,
});
