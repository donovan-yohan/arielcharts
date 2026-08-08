export type StarterTemplateDiagramType =
  | 'blank'
  | 'sequenceDiagram'
  | 'flowchart'
  | 'erDiagram'
  | 'stateDiagram-v2'
  | 'timeline';

type StarterTemplateDefinition = Readonly<{
  id: string;
  label: string;
  defaultName: string;
  description: string;
  diagramType: StarterTemplateDiagramType;
  source: string;
}>;

const starterTemplates = [
  {
    id: 'blank',
    label: 'Blank sheet',
    defaultName: 'Untitled diagram',
    description: 'An empty Mermaid sheet for a diagram you want to sketch from scratch.',
    diagramType: 'blank',
    source: '',
  },
  {
    id: 'api-sequence',
    label: 'End-to-end API sequence',
    defaultName: 'API sequence',
    description: 'A request, response, and failure-path conversation between a client and API.',
    diagramType: 'sequenceDiagram',
    source: `sequenceDiagram
  autonumber
  participant Client
  participant API
  participant Service
  Client->>API: POST /orders
  API->>Service: create order
  Service-->>API: order created
  API-->>Client: 201 Created
  alt validation fails
    API-->>Client: 422 Validation error
  end`,
  },
  {
    id: 'service-flowchart',
    label: 'Service / system flowchart',
    defaultName: 'Service flow',
    description: 'A flowchart for the main request path through a service boundary.',
    diagramType: 'flowchart',
    source: `flowchart LR
  Client[Client] --> Gateway[API gateway]
  Gateway --> Service[Application service]
  Service --> Database[(Primary database)]`,
  },
  {
    id: 'data-model-er',
    label: 'Data model / ER diagram',
    defaultName: 'Data model',
    description: 'A starter entity relationship model with a parent and child record.',
    diagramType: 'erDiagram',
    source: `erDiagram
  CUSTOMER ||--o{ ORDER : places
  CUSTOMER {
    string id PK
    string email
  }
  ORDER {
    string id PK
    string customer_id FK
    string status
  }`,
  },
  {
    id: 'state-machine',
    label: 'State machine',
    defaultName: 'State machine',
    description: 'A state transition model for a healthy, degraded, and recovered service.',
    diagramType: 'stateDiagram-v2',
    source: `stateDiagram-v2
  [*] --> Healthy
  Healthy --> Degraded: alert
  Degraded --> Healthy: recovered
  Degraded --> [*]: retired`,
  },
  {
    id: 'incident-timeline',
    label: 'Incident timeline',
    defaultName: 'Incident timeline',
    description: 'A concise incident response timeline from alert through recovery.',
    diagramType: 'timeline',
    source: `timeline
  title Incident response
  2026 : Alert fires
       : On-call acknowledges
  2027 : Mitigation deployed
       : Service recovered`,
  },
  {
    id: 'deployment-architecture',
    label: 'Deployment architecture',
    defaultName: 'Deployment architecture',
    description: 'A deployable service topology using supported flowchart syntax.',
    diagramType: 'flowchart',
    source: `flowchart TB
  Browser[Browser] --> CDN[CDN]
  CDN --> API[API service]
  API --> Queue[(Job queue)]
  API --> Database[(Primary database)]
  Worker[Worker] --> Queue
  Worker --> Database`,
  },
] as const satisfies readonly StarterTemplateDefinition[];

export type StarterTemplateId = (typeof starterTemplates)[number]['id'];

export type StarterTemplate = (typeof starterTemplates)[number];

export const STARTER_TEMPLATES: readonly StarterTemplate[] = Object.freeze(
  starterTemplates.map((template) => Object.freeze({ ...template })),
);

export function getStarterTemplate(id: string): StarterTemplate | undefined {
  return STARTER_TEMPLATES.find((template) => template.id === id);
}
