/** The Mermaid detector registry this catalog was audited against. */
export const MERMAID_DIAGRAM_CATALOG_VERSION = '11.16.1';

export type MermaidDiagramEditingModel = 'canvas' | 'semantic-form';
export type MermaidDiagramStability = 'stable' | 'preview';
export type MermaidDiagramAvailability = 'available' | 'available-plugin' | 'unavailable-plugin';

export interface MermaidDiagramStarter {
  defaultName: string;
  description: string;
  id: string;
  source: string;
}

export interface MermaidDiagramFamilyDescriptor {
  availability: 'available';
  editingModel: MermaidDiagramEditingModel;
  help: string;
  helpUrl: string;
  /** Mermaid detector IDs returned by `mermaid.parse`, not authored header text. */
  parserTypes: readonly string[];
  id: string;
  label: string;
  stability: MermaidDiagramStability;
  starter: MermaidDiagramStarter;
}

export interface ExternalMermaidDiagramFamilyDescriptor {
  availability: 'available-plugin' | 'unavailable-plugin';
  editingModel?: MermaidDiagramEditingModel;
  help: string;
  helpUrl: string;
  /** Mermaid detector IDs returned after the external plugin is registered. */
  parserTypes: readonly string[];
  id: string;
  label: string;
  stability: MermaidDiagramStability;
  starter?: MermaidDiagramStarter;
}

/**
 * Every built-in visual Mermaid family in 11.16.1. The catalog is platform
 * neutral: creation resolves a starter to ordinary source, while browser
 * adapters attach their own safe mutation models by family ID.
 */
const mermaidDiagramFamilies = [
  { id: 'architecture', label: 'Architecture', parserTypes: ['architecture'], editingModel: 'semantic-form', stability: 'preview', availability: 'available', help: 'Model services, groups, junctions, and directional relationships.', starter: { id: 'architecture', defaultName: 'Architecture', description: 'A minimal architecture service.', source: 'architecture-beta\n  service api(server)[API]' } },
  { id: 'block', label: 'Block', parserTypes: ['block'], editingModel: 'semantic-form', stability: 'preview', availability: 'available', help: 'Arrange labeled blocks, composites, and links.', starter: { id: 'block', defaultName: 'Block diagram', description: 'A minimal block diagram.', source: 'block-beta\n  api' } },
  { id: 'c4', label: 'C4', parserTypes: ['c4'], editingModel: 'semantic-form', stability: 'preview', availability: 'available', help: 'Describe people, systems, boundaries, and relationships.', starter: { id: 'c4', defaultName: 'C4 diagram', description: 'A minimal C4 context.', source: 'C4Context\n  Person(user, "User")' } },
  { id: 'class', label: 'Class', parserTypes: ['class', 'classDiagram'], editingModel: 'semantic-form', stability: 'stable', availability: 'available', help: 'Describe classes, members, annotations, and relationships.', starter: { id: 'class', defaultName: 'Class diagram', description: 'A minimal class diagram.', source: 'classDiagram\n  class Account' } },
  { id: 'cynefin', label: 'Cynefin', parserTypes: ['cynefin'], editingModel: 'semantic-form', stability: 'preview', availability: 'available', help: 'Place work in Cynefin domains and connect transitions.', starter: { id: 'cynefin', defaultName: 'Cynefin map', description: 'A minimal Cynefin map.', source: 'cynefin-beta\n  complex\n    "Uncertain"' } },
  { id: 'entity-relationship', label: 'Entity relationship', parserTypes: ['er'], editingModel: 'semantic-form', stability: 'stable', availability: 'available', help: 'Model entities, attributes, and cardinality relationships.', starter: { id: 'entity-relationship', defaultName: 'Data model', description: 'A minimal entity relationship diagram.', source: 'erDiagram\n  CUSTOMER {\n    string id\n  }' } },
  { id: 'event-modeling', label: 'Event modeling', parserTypes: ['eventmodeling'], editingModel: 'semantic-form', stability: 'preview', availability: 'available', help: 'Map timeframes, commands, events, entities, and data.', starter: { id: 'event-modeling', defaultName: 'Event model', description: 'A minimal event-modeling map.', source: 'eventmodeling\n  tf 01 evt Start' } },
  { id: 'flowchart', label: 'Flowchart', parserTypes: ['flowchart', 'flowchart-v2', 'flowchart-elk'], editingModel: 'canvas', stability: 'stable', availability: 'available', help: 'Sketch connected nodes and nested subgraphs on the canvas.', starter: { id: 'flowchart', defaultName: 'Flowchart', description: 'A minimal flowchart.', source: 'flowchart TD\n  Start --> Finish' } },
  { id: 'gantt', label: 'Gantt', parserTypes: ['gantt'], editingModel: 'semantic-form', stability: 'stable', availability: 'available', help: 'Plan dated tasks in sections.', starter: { id: 'gantt', defaultName: 'Gantt chart', description: 'A minimal dated task.', source: 'gantt\n  dateFormat YYYY-MM-DD\n  section Build\n  Task :done, task, 2026-01-01, 1d' } },
  { id: 'gitgraph', label: 'Gitgraph', parserTypes: ['gitGraph'], editingModel: 'semantic-form', stability: 'stable', availability: 'available', help: 'Visualize branches, commits, checkouts, and merges.', starter: { id: 'gitgraph', defaultName: 'Gitgraph', description: 'A minimal commit history.', source: 'gitGraph\n  commit id: "ZERO"' } },
  { id: 'ishikawa', label: 'Ishikawa', parserTypes: ['ishikawa'], editingModel: 'semantic-form', stability: 'preview', availability: 'available', help: 'Analyze a problem through causes and nested causes.', starter: { id: 'ishikawa', defaultName: 'Ishikawa diagram', description: 'A minimal cause-and-effect diagram.', source: 'ishikawa-beta\n  "Problem"' } },
  { id: 'journey', label: 'User journey', parserTypes: ['journey'], editingModel: 'semantic-form', stability: 'stable', availability: 'available', help: 'Map user tasks and satisfaction by section.', starter: { id: 'journey', defaultName: 'User journey', description: 'A minimal user journey.', source: 'journey\n  Task: 5: Customer' } },
  { id: 'kanban', label: 'Kanban', parserTypes: ['kanban'], editingModel: 'semantic-form', stability: 'preview', availability: 'available', help: 'Organize columns, cards, and card metadata.', starter: { id: 'kanban', defaultName: 'Kanban board', description: 'A minimal kanban board.', source: 'kanban\n  todo[Todo]' } },
  { id: 'mindmap', label: 'Mindmap', parserTypes: ['mindmap'], editingModel: 'semantic-form', stability: 'preview', availability: 'available', help: 'Explore a hierarchical topic tree.', starter: { id: 'mindmap', defaultName: 'Mindmap', description: 'A minimal mindmap.', source: 'mindmap\n  Root\n    Child' } },
  { id: 'packet', label: 'Packet', parserTypes: ['packet'], editingModel: 'semantic-form', stability: 'preview', availability: 'available', help: 'Lay out named protocol packet fields.', starter: { id: 'packet', defaultName: 'Packet diagram', description: 'A minimal packet layout.', source: 'packet-beta\n  0-7: "Version"' } },
  { id: 'pie', label: 'Pie', parserTypes: ['pie'], editingModel: 'semantic-form', stability: 'stable', availability: 'available', help: 'Compare labeled values as slices.', starter: { id: 'pie', defaultName: 'Pie chart', description: 'A minimal pie chart.', source: 'pie\n  "A" : 1' } },
  { id: 'quadrant', label: 'Quadrant chart', parserTypes: ['quadrantChart'], editingModel: 'semantic-form', stability: 'stable', availability: 'available', help: 'Position named points on two axes.', starter: { id: 'quadrant', defaultName: 'Quadrant chart', description: 'A minimal quadrant chart.', source: 'quadrantChart\n  x-axis Low --> High\n  y-axis Low --> High\n  A: [0.5, 0.5]' } },
  { id: 'radar', label: 'Radar', parserTypes: ['radar'], editingModel: 'semantic-form', stability: 'preview', availability: 'available', help: 'Compare curves across named axes.', starter: { id: 'radar', defaultName: 'Radar chart', description: 'A minimal radar chart.', source: 'radar-beta\n  axis A\n  axis B\n  axis C\n  curve one {1, 2, 3}' } },
  { id: 'railroad', label: 'Railroad', parserTypes: ['railroad', 'railroadEbnf', 'railroadAbnf', 'railroadPeg'], editingModel: 'semantic-form', stability: 'preview', availability: 'available', help: 'Express a grammar as railroad productions.', starter: { id: 'railroad', defaultName: 'Railroad diagram', description: 'A minimal grammar production.', source: 'railroad-beta\n  Start = terminal("a");' } },
  { id: 'requirement', label: 'Requirement', parserTypes: ['requirement'], editingModel: 'semantic-form', stability: 'stable', availability: 'available', help: 'Trace requirements, elements, and relationships.', starter: { id: 'requirement', defaultName: 'Requirements', description: 'A minimal requirement.', source: 'requirementDiagram\n  requirement req1 {\n    id: 1\n    text: "Example"\n    risk: low\n    verifyMethod: test\n  }' } },
  { id: 'sankey', label: 'Sankey', parserTypes: ['sankey'], editingModel: 'semantic-form', stability: 'preview', availability: 'available', help: 'Show weighted flows between named nodes.', starter: { id: 'sankey', defaultName: 'Sankey diagram', description: 'A minimal weighted flow.', source: 'sankey-beta\n  A,B,1' } },
  { id: 'sequence', label: 'Sequence', parserTypes: ['sequence'], editingModel: 'semantic-form', stability: 'stable', availability: 'available', help: 'Describe participants and time-ordered messages.', starter: { id: 'sequence', defaultName: 'Sequence diagram', description: 'A minimal sequence message.', source: 'sequenceDiagram\n  A->>B: Request' } },
  { id: 'state', label: 'State', parserTypes: ['state', 'stateDiagram'], editingModel: 'semantic-form', stability: 'stable', availability: 'available', help: 'Model states and transitions.', starter: { id: 'state', defaultName: 'State diagram', description: 'A minimal state transition.', source: 'stateDiagram-v2\n  [*] --> Active' } },
  { id: 'swimlane', label: 'Swimlane', parserTypes: ['swimlane'], editingModel: 'semantic-form', stability: 'preview', availability: 'available', help: 'Divide flowchart work into lanes.', starter: { id: 'swimlane', defaultName: 'Swimlane diagram', description: 'A minimal lane handoff.', source: 'swimlane-beta\n  subgraph lane [Lane]\n    start[Start]\n    finish[Finish]\n  end\n  start --> finish' } },
  { id: 'timeline', label: 'Timeline', parserTypes: ['timeline'], editingModel: 'semantic-form', stability: 'preview', availability: 'available', help: 'Arrange dated events in order.', starter: { id: 'timeline', defaultName: 'Timeline', description: 'A minimal timeline event.', source: 'timeline\n  2026 : Started' } },
  { id: 'tree-view', label: 'Tree view', parserTypes: ['treeView'], editingModel: 'semantic-form', stability: 'preview', availability: 'available', help: 'Render a hierarchical file-like tree.', starter: { id: 'tree-view', defaultName: 'Tree view', description: 'A minimal tree view.', source: 'treeView-beta\n  Root\n    Child' } },
  { id: 'treemap', label: 'Treemap', parserTypes: ['treemap'], editingModel: 'semantic-form', stability: 'preview', availability: 'available', help: 'Compare nested weighted categories.', starter: { id: 'treemap', defaultName: 'Treemap', description: 'A minimal treemap.', source: 'treemap-beta\n  "Root"\n    "Leaf": 1' } },
  { id: 'venn', label: 'Venn', parserTypes: ['venn'], editingModel: 'semantic-form', stability: 'preview', availability: 'available', help: 'Compare sets, overlaps, and optional styles.', starter: { id: 'venn', defaultName: 'Venn diagram', description: 'A minimal set overlap.', source: 'venn-beta\n  set A: 1\n  set B: 1\n  union A, B: 0.5' } },
  { id: 'wardley', label: 'Wardley', parserTypes: ['wardley'], editingModel: 'semantic-form', stability: 'preview', availability: 'available', help: 'Map components by value chain and evolution.', starter: { id: 'wardley', defaultName: 'Wardley map', description: 'A minimal Wardley component.', source: 'wardley-beta\n  component Foo [0.5, 0.5]' } },
  { id: 'xy-chart', label: 'XY chart', parserTypes: ['xychart'], editingModel: 'semantic-form', stability: 'preview', availability: 'available', help: 'Plot bar and line series against axes.', starter: { id: 'xy-chart', defaultName: 'XY chart', description: 'A minimal XY chart.', source: 'xychart-beta\n  x-axis ["A", "B"]\n  y-axis 0 --> 3\n  line [1, 2]' } },
] as const satisfies readonly Omit<MermaidDiagramFamilyDescriptor, 'helpUrl'>[];

export type MermaidDiagramFamilyId = typeof mermaidDiagramFamilies[number]['id'];

const HELP_PATH_BY_FAMILY: Readonly<Record<MermaidDiagramFamilyId, string>> = {
  architecture: 'architecture', block: 'block', c4: 'c4', class: 'classDiagram', cynefin: 'cynefin',
  'entity-relationship': 'entityRelationshipDiagram', 'event-modeling': 'eventmodeling', flowchart: 'flowchart',
  gantt: 'gantt', gitgraph: 'gitgraph', ishikawa: 'ishikawa', journey: 'userJourney', kanban: 'kanban',
  mindmap: 'mindmap', packet: 'packet', pie: 'pie', quadrant: 'quadrantChart', radar: 'radar', railroad: 'railroad',
  requirement: 'requirementDiagram', sankey: 'sankey', sequence: 'sequenceDiagram', state: 'stateDiagram',
  swimlane: 'swimlanes', timeline: 'timeline', 'tree-view': 'treeView', treemap: 'treemap', venn: 'venn',
  wardley: 'wardley', 'xy-chart': 'xyChart',
};

export const MERMAID_DIAGRAM_FAMILIES: readonly (typeof mermaidDiagramFamilies[number] & { helpUrl: string })[] = Object.freeze(
  mermaidDiagramFamilies.map((family) => Object.freeze({
    ...family,
    parserTypes: Object.freeze([...family.parserTypes]),
    starter: Object.freeze({ ...family.starter }),
    helpUrl: `https://mermaid.js.org/syntax/${HELP_PATH_BY_FAMILY[family.id]}.html`,
  })),
) as unknown as readonly (typeof mermaidDiagramFamilies[number] & { helpUrl: string })[];

/** External families stay separate because the browser owns their lazy runtime. */
export const EXTERNAL_MERMAID_PLUGIN_FAMILIES = Object.freeze([
  Object.freeze({
    id: 'zenuml', label: 'ZenUML', parserTypes: Object.freeze(['zenuml', 'zenUml']),
    editingModel: 'semantic-form', stability: 'preview', availability: 'available-plugin',
    help: 'Model code-shaped interactions with the bundled, lazily loaded ZenUML renderer.',
    helpUrl: 'https://mermaid.js.org/syntax/zenuml.html',
    starter: Object.freeze({
      id: 'zenuml', defaultName: 'ZenUML sequence', description: 'A minimal code-shaped service interaction.',
      source: 'zenuml\n  Client->API: request',
    }),
  }),
] as const satisfies readonly ExternalMermaidDiagramFamilyDescriptor[]);

export type ExternalMermaidDiagramFamilyId = typeof EXTERNAL_MERMAID_PLUGIN_FAMILIES[number]['id'];

const familyByParserType = new Map(
  MERMAID_DIAGRAM_FAMILIES.flatMap((family) => family.parserTypes.map((parserType) => [parserType.toLowerCase(), family] as const)),
);
const externalFamilyByParserType = new Map(
  EXTERNAL_MERMAID_PLUGIN_FAMILIES.flatMap((family) => family.parserTypes.map((parserType) => [parserType.toLowerCase(), family] as const)),
);

export function getMermaidDiagramFamily(parserType: string): typeof MERMAID_DIAGRAM_FAMILIES[number] | undefined {
  return familyByParserType.get(parserType.trim().toLowerCase());
}

export function getExternalMermaidDiagramFamily(parserType: string): typeof EXTERNAL_MERMAID_PLUGIN_FAMILIES[number] | undefined {
  return externalFamilyByParserType.get(parserType.trim().toLowerCase());
}
