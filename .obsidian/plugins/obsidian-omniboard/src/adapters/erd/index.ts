import { makeStubAdapter } from "../makeStubAdapter";

export const erdAdapter = makeStubAdapter({
  id: "erd",
  displayName: "ER Diagram",
  codeBlockLanguage: "erd",
  icon: "table",
  template: `// @diagram-version: 1
Table customers {
  id int [pk]
  name varchar
  // @pos: 120,80
}`,
});
