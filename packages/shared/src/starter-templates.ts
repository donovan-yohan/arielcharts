import {
  MERMAID_DIAGRAM_FAMILIES,
  EXTERNAL_MERMAID_PLUGIN_FAMILIES,
  type MermaidDiagramEditingModel,
  type MermaidDiagramFamilyId,
  type MermaidDiagramStability,
} from './mermaid-diagram-catalog.js';

/** The authored header names exposed by the pre-catalog public starter set. */
export type LegacyStarterTemplateDiagramType = 'blank' | 'sequenceDiagram' | 'flowchart' | 'erDiagram' | 'stateDiagram-v2' | 'timeline';
export type StarterTemplateDiagramType = LegacyStarterTemplateDiagramType | MermaidDiagramFamilyId | 'zenuml';

export type StarterTemplate = Readonly<{
  id: string;
  label: string;
  defaultName: string;
  description: string;
  diagramType: StarterTemplateDiagramType;
  editingModel?: MermaidDiagramEditingModel;
  familyId?: MermaidDiagramFamilyId;
  helpUrl?: string;
  source: string;
  stability?: MermaidDiagramStability;
}>;

export type LegacyStarterTemplateId = 'api-sequence' | 'service-flowchart' | 'data-model-er' | 'state-machine' | 'incident-timeline' | 'deployment-architecture';
export type StarterTemplateId = 'blank' | LegacyStarterTemplateId | typeof MERMAID_DIAGRAM_FAMILIES[number]['starter']['id'] | 'zenuml';

/**
 * The established public starter export. Keep these seven values byte-for-byte
 * compatible in their curated labels, descriptions, authored headers, and source.
 * The chooser uses PRIMARY_STARTER_TEMPLATES instead.
 */
const legacyStarterTemplates = [
  { id: 'blank', label: 'Blank sheet', defaultName: 'Untitled diagram', description: 'An empty Mermaid sheet for a diagram you want to sketch from scratch.', diagramType: 'blank', source: '' },
  { id: 'api-sequence', label: 'End-to-end API sequence', defaultName: 'API sequence', description: 'A request, response, and failure-path conversation between a client and API.', diagramType: 'sequenceDiagram', source: 'sequenceDiagram\n  autonumber\n  participant Client\n  participant API\n  participant Service\n  Client->>API: POST /orders\n  API->>Service: create order\n  Service-->>API: order created\n  API-->>Client: 201 Created\n  alt validation fails\n    API-->>Client: 422 Validation error\n  end' },
  { id: 'service-flowchart', label: 'Service / system flowchart', defaultName: 'Service flow', description: 'A flowchart for the main request path through a service boundary.', diagramType: 'flowchart', source: 'flowchart LR\n  Client[Client] --> Gateway[API gateway]\n  Gateway --> Service[Application service]\n  Service --> Database[(Primary database)]' },
  { id: 'data-model-er', label: 'Data model / ER diagram', defaultName: 'Data model', description: 'A starter entity relationship model with a parent and child record.', diagramType: 'erDiagram', source: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  CUSTOMER {\n    string id PK\n    string email\n  }\n  ORDER {\n    string id PK\n    string customer_id FK\n    string status\n  }' },
  { id: 'state-machine', label: 'State machine', defaultName: 'State machine', description: 'A state transition model for a healthy, degraded, and recovered service.', diagramType: 'stateDiagram-v2', source: 'stateDiagram-v2\n  [*] --> Healthy\n  Healthy --> Degraded: alert\n  Degraded --> Healthy: recovered\n  Degraded --> [*]: retired' },
  { id: 'incident-timeline', label: 'Incident timeline', defaultName: 'Incident timeline', description: 'A concise incident response timeline from alert through recovery.', diagramType: 'timeline', source: 'timeline\n  title Incident response\n  2026 : Alert fires\n       : On-call acknowledges\n  2027 : Mitigation deployed\n       : Service recovered' },
  { id: 'deployment-architecture', label: 'Deployment architecture', defaultName: 'Deployment architecture', description: 'A deployable service topology using supported flowchart syntax.', diagramType: 'flowchart', source: 'flowchart TB\n  Browser[Browser] --> CDN[CDN]\n  CDN --> API[API service]\n  API --> Queue[(Job queue)]\n  API --> Database[(Primary database)]\n  Worker[Worker] --> Queue\n  Worker --> Database' },
] as const satisfies readonly StarterTemplate[];

export const STARTER_TEMPLATES: readonly StarterTemplate[] = Object.freeze(
  legacyStarterTemplates.map((template) => Object.freeze({ ...template })),
);

/** The Blank + 30 catalog starters surfaced in the chooser and generated conformance. */
export const PRIMARY_STARTER_TEMPLATES: readonly StarterTemplate[] = Object.freeze([
  Object.freeze({ id: 'blank', label: 'Blank sheet', defaultName: 'Untitled diagram', description: 'An empty Mermaid sheet for a diagram you want to sketch from scratch.', diagramType: 'blank', helpUrl: 'https://mermaid.js.org/intro/', source: '' } as const satisfies StarterTemplate),
  ...MERMAID_DIAGRAM_FAMILIES.map((family) => Object.freeze({
    id: family.starter.id,
    label: family.label,
    defaultName: family.starter.defaultName,
    description: family.starter.description,
    diagramType: family.id,
    editingModel: family.editingModel,
    familyId: family.id,
    helpUrl: family.helpUrl,
    source: family.starter.source,
    stability: family.stability,
  })),
]);

/** Explicit name for UI consumers: aliases are accepted but never shown as choices. */
export const CHOOSER_STARTER_TEMPLATES = PRIMARY_STARTER_TEMPLATES;

/** The six compatibility-only members of the established STARTER_TEMPLATES export. */
export const STARTER_TEMPLATE_ALIASES: readonly StarterTemplate[] = Object.freeze(STARTER_TEMPLATES.slice(1));

export const EXTERNAL_STARTER_TEMPLATES: readonly StarterTemplate[] = Object.freeze(
  EXTERNAL_MERMAID_PLUGIN_FAMILIES.flatMap((family) => family.starter ? [Object.freeze({
    id: family.starter.id,
    label: family.label,
    defaultName: family.starter.defaultName,
    description: family.starter.description,
    diagramType: family.id,
    editingModel: family.editingModel,
    helpUrl: family.helpUrl,
    source: family.starter.source,
    stability: family.stability,
  })] : []),
);

/** Every accepted ID, with the pre-catalog public values first and Blank de-duplicated. */
export const ALL_STARTER_TEMPLATES: readonly StarterTemplate[] = Object.freeze([
  ...STARTER_TEMPLATES,
  ...PRIMARY_STARTER_TEMPLATES.filter((primary) => !STARTER_TEMPLATES.some((legacy) => legacy.id === primary.id)),
  ...EXTERNAL_STARTER_TEMPLATES,
]);

export function getStarterTemplate(id: string): StarterTemplate | undefined {
  return ALL_STARTER_TEMPLATES.find((template) => template.id === id);
}
