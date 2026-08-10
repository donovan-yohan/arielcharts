import { MERMAID_CAPABILITY_CATALOG_VERSION, type MermaidDiagramFamilyId } from './diagram-capabilities';

export interface MermaidCapabilityFixture {
  advancedSource: string;
  family: MermaidDiagramFamilyId;
  headerOnlySource: string;
  invalidSource: string;
  parserTypes: readonly string[];
  validSource: string;
}

/**
 * Compact source corpus for the Mermaid 11.16.1 detector registry. The
 * catalog test asserts the complete parser-ID matrix; rendering tests can use
 * the representative source without embedding a second copy of the registry.
 */
export const MERMAID_CAPABILITY_FIXTURE_VERSION = MERMAID_CAPABILITY_CATALOG_VERSION;

/** These grammars have no empty production; their header is detector-only by design. */
export const HEADER_ONLY_DETECTION_ONLY_FAMILIES: readonly MermaidDiagramFamilyId[] = [
  'block', 'c4', 'class', 'ishikawa', 'kanban', 'mindmap', 'sankey',
];

export const MERMAID_CAPABILITY_FIXTURES: readonly MermaidCapabilityFixture[] = [
  { family: 'architecture', parserTypes: ['architecture'], headerOnlySource: 'architecture-beta', validSource: 'architecture-beta\n  service api(server)[API]', advancedSource: 'architecture-beta\n  service api(server)[API]\n  service db(database)[Database]\n  api:R --> L:db', invalidSource: 'architecture-beta\n  service' },
  { family: 'block', parserTypes: ['block'], headerOnlySource: 'block-beta', validSource: 'block-beta\n  a', advancedSource: 'block-beta\n  columns 2\n  a b\n  a --> b', invalidSource: 'block-beta\n  a{' },
  { family: 'c4', parserTypes: ['c4'], headerOnlySource: 'C4Context', validSource: 'C4Context\n  Person(customer, "Customer")', advancedSource: 'C4Context\n  Person(customer, "Customer")\n  System(system, "System")\n  Rel(customer, system, "Uses")', invalidSource: 'C4Context\n  Person(' },
  { family: 'class', parserTypes: ['class', 'classDiagram'], headerOnlySource: 'classDiagram', validSource: 'classDiagram\n  class Animal', advancedSource: 'classDiagram-v2\n  class Animal {\n    +String name\n  }', invalidSource: 'classDiagram\n  class {' },
  { family: 'cynefin', parserTypes: ['cynefin'], headerOnlySource: 'cynefin-beta', validSource: 'cynefin-beta\n  title Example', advancedSource: 'cynefin-beta\n  complex\n    "Uncertain"', invalidSource: 'cynefin-beta\n  domain' },
  { family: 'entity-relationship', parserTypes: ['er'], headerOnlySource: 'erDiagram', validSource: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places', advancedSource: 'erDiagram\n  CUSTOMER { string name }\n  CUSTOMER ||--o{ ORDER : places', invalidSource: 'erDiagram\n  CUSTOMER ||--o{ : places' },
  { family: 'event-modeling', parserTypes: ['eventmodeling'], headerOnlySource: 'eventmodeling', validSource: 'eventmodeling\n  tf 01 evt Start', advancedSource: 'eventmodeling\n  entity Order\n  tf 01 cmd Order\n  tf 02 evt Order ->> 01', invalidSource: 'eventmodeling\n  tf nope evt Start' },
  { family: 'flowchart', parserTypes: ['flowchart', 'flowchart-v2', 'flowchart-elk'], headerOnlySource: 'flowchart TD', validSource: 'flowchart TD\n  A --> B', advancedSource: 'flowchart-elk TD\n  subgraph Group\n    A --> B\n  end', invalidSource: 'flowchart TD\n  A -->' },
  { family: 'gantt', parserTypes: ['gantt'], headerOnlySource: 'gantt', validSource: 'gantt\n  title Example\n  dateFormat YYYY-MM-DD\n  Task : 2026-01-01, 1d', advancedSource: 'gantt\n  title Example\n  dateFormat YYYY-MM-DD\n  section Build\n  Task :done, 2026-01-01, 1d', invalidSource: 'gantt\n  dateFormat' },
  { family: 'gitgraph', parserTypes: ['gitGraph'], headerOnlySource: 'gitGraph', validSource: 'gitGraph\n  commit id: "ZERO"', advancedSource: 'gitGraph\n  commit id: "ZERO"\n  branch feature\n  checkout feature\n  commit id: "ONE"', invalidSource: 'gitGraph\n  commit id:' },
  // Ishikawa accepts every non-newline statement, so malformed frontmatter is its only rejected input class.
  { family: 'ishikawa', parserTypes: ['ishikawa'], headerOnlySource: 'ishikawa-beta', validSource: 'ishikawa-beta\n  "Problem"', advancedSource: 'ishikawa-beta\n  "Problem"\n  "People": "Training"', invalidSource: '---\nishikawa-beta\n  "Problem"' },
  { family: 'journey', parserTypes: ['journey'], headerOnlySource: 'journey', validSource: 'journey\n  title Example\n  Task: 5: Alice', advancedSource: 'journey\n  title Example\n  section Product\n  Task: 5: Alice, Bob', invalidSource: 'journey\n  Task' },
  { family: 'kanban', parserTypes: ['kanban'], headerOnlySource: 'kanban', validSource: 'kanban\n  todo[Todo]', advancedSource: 'kanban\n  todo[Todo]\n    task1[Task]@{ assigned: "Alice" }', invalidSource: 'kanban\n  todo[' },
  { family: 'mindmap', parserTypes: ['mindmap'], headerOnlySource: 'mindmap', validSource: 'mindmap\n  Root\n    Child', advancedSource: 'mindmap\n  Root\n    Branch\n      Leaf', invalidSource: 'mindmap\n  Root(' },
  { family: 'packet', parserTypes: ['packet'], headerOnlySource: 'packet-beta', validSource: 'packet-beta\n  0-7: "Version"', advancedSource: 'packet-beta\n  0-7: "Version"\n  8-15: "Length"', invalidSource: 'packet-beta\n  bad' },
  { family: 'pie', parserTypes: ['pie'], headerOnlySource: 'pie', validSource: 'pie title Example\n  "A" : 1', advancedSource: 'pie showData\n  title Example\n  "A" : 1\n  "B" : 2', invalidSource: 'pie\n  "A" :' },
  { family: 'quadrant', parserTypes: ['quadrantChart'], headerOnlySource: 'quadrantChart', validSource: 'quadrantChart\n  x-axis Low --> High\n  y-axis Low --> High\n  A: [0.5, 0.5]', advancedSource: 'quadrantChart\n  title Example\n  quadrant-1 High\n  x-axis Low --> High\n  y-axis Low --> High\n  A: [0.5, 0.5]', invalidSource: 'quadrantChart\n  A: [bad]' },
  { family: 'radar', parserTypes: ['radar'], headerOnlySource: 'radar-beta', validSource: 'radar-beta\n  axis A, B\n  curve one{1, 2}', advancedSource: 'radar-beta\n  title Example\n  axis A, B, C\n  curve one{1, 2, 3}', invalidSource: 'radar-beta\n  curve' },
  { family: 'railroad', parserTypes: ['railroad', 'railroadEbnf', 'railroadAbnf', 'railroadPeg'], headerOnlySource: 'railroad-beta', validSource: 'railroad-beta\n  Start = terminal("a");', advancedSource: 'railroad-beta\n  Start = choice(terminal("a"), terminal("b"));', invalidSource: 'railroad-beta\n  Start = ???;' },
  { family: 'requirement', parserTypes: ['requirement'], headerOnlySource: 'requirementDiagram', validSource: 'requirementDiagram\n  requirement req1 {\n    id: 1\n    text: "Example"\n    risk: low\n    verifyMethod: test\n  }', advancedSource: 'requirementDiagram\n  requirement req1 {\n    id: 1\n    text: "Example"\n    risk: low\n    verifyMethod: test\n  }\n  element product {\n    type: product\n  }\n  req1 - satisfies -> product', invalidSource: 'requirementDiagram\n  requirement {' },
  { family: 'sankey', parserTypes: ['sankey'], headerOnlySource: 'sankey-beta', validSource: 'sankey-beta\n  A,B,1', advancedSource: 'sankey-beta\n  A,B,1\n  B,C,2', invalidSource: 'sankey-beta\n  A,B' },
  { family: 'sequence', parserTypes: ['sequence'], headerOnlySource: 'sequenceDiagram', validSource: 'sequenceDiagram\n  A->>B: Request', advancedSource: 'sequenceDiagram\n  participant A as API\n  participant B as Browser\n  A->>B: Request', invalidSource: 'sequenceDiagram\n  A->>:' },
  { family: 'state', parserTypes: ['state', 'stateDiagram'], headerOnlySource: 'stateDiagram-v2', validSource: 'stateDiagram-v2\n  [*] --> Active', advancedSource: 'stateDiagram-v2\n  state Active {\n    [*] --> Ready\n  }', invalidSource: 'stateDiagram-v2\n  [*] -->' },
  { family: 'swimlane', parserTypes: ['swimlane'], headerOnlySource: 'swimlane-beta', validSource: 'swimlane-beta\n  A --> B', advancedSource: 'swimlane-beta\n  subgraph Lane\n    A --> B\n  end', invalidSource: 'swimlane-beta\n  A -->' },
  { family: 'timeline', parserTypes: ['timeline'], headerOnlySource: 'timeline', validSource: 'timeline\n  2026 : Started', advancedSource: 'timeline\n  title Example\n  2026 : Started\n       : Shipped', invalidSource: 'timeline\n  :' },
  { family: 'tree-view', parserTypes: ['treeView'], headerOnlySource: 'treeView-beta', validSource: 'treeView-beta\n  Root\n    Child', advancedSource: 'treeView-beta\n  Root\n    Branch\n      Leaf', invalidSource: 'treeView-beta\n  "Unclosed' },
  { family: 'treemap', parserTypes: ['treemap'], headerOnlySource: 'treemap-beta', validSource: 'treemap-beta\n  "Root"\n    "Leaf": 1', advancedSource: 'treemap-beta\n  "Root"\n    "First": 1\n    "Second": 2', invalidSource: 'treemap-beta\n  bad' },
  { family: 'venn', parserTypes: ['venn'], headerOnlySource: 'venn-beta', validSource: 'venn-beta\n  set A: 1\n  set B: 1\n  union A, B: 0.5', advancedSource: 'venn-beta\n  title Example\n  set A: 1\n  set B: 1\n  union A, B: 0.5', invalidSource: 'venn-beta\n  union A' },
  { family: 'wardley', parserTypes: ['wardley'], headerOnlySource: 'wardley-beta', validSource: 'wardley-beta\n  component Foo [0.5, 0.5]', advancedSource: 'wardley-beta\n  title Example\n  component Foo [0.5, 0.5]\n  component Bar [0.7, 0.2]\n  Foo -> Bar', invalidSource: 'wardley-beta\n  component' },
  { family: 'xy-chart', parserTypes: ['xychart'], headerOnlySource: 'xychart-beta', validSource: 'xychart-beta\n  x-axis [A, B]\n  bar [1, 2]', advancedSource: 'xychart-beta\n  title Example\n  x-axis [A, B]\n  y-axis 0 --> 3\n  line [1, 2]', invalidSource: 'xychart-beta\n  bar' },
];
