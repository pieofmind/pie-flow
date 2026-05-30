import { makeStubAdapter } from "../makeStubAdapter";

export const sequenceAdapter = makeStubAdapter({
  id: "sequence",
  displayName: "Sequence",
  codeBlockLanguage: "sequence",
  icon: "arrow-left-right",
  template: `sequenceDiagram
  participant A as Client
  participant B as Server
  A->>B: Request
  B-->>A: Response`,
});
