import { makeStubAdapter } from "../makeStubAdapter";

export const mindmapAdapter = makeStubAdapter({
  id: "mindmap",
  displayName: "Mindmap",
  codeBlockLanguage: "mindmap",
  icon: "network",
  template: `# Central topic
## Branch A
### Leaf 1
### Leaf 2
## Branch B
### Leaf 3`,
});
