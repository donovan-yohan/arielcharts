// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_MERMAID_PLUGIN_FAMILIES,
  getMermaidDiagramFamily,
  MERMAID_DIAGRAM_CATALOG_VERSION,
  MERMAID_DIAGRAM_FAMILIES,
} from './mermaid-diagram-catalog.js';
import { ALL_STARTER_TEMPLATES, CHOOSER_STARTER_TEMPLATES, getStarterTemplate, PRIMARY_STARTER_TEMPLATES, STARTER_TEMPLATE_ALIASES, STARTER_TEMPLATES } from './starter-templates.js';

describe('starter templates', () => {
  it('keeps the established seven public starters while deriving separate primary chooser entries', () => {
    expect(MERMAID_DIAGRAM_CATALOG_VERSION).toBe('11.16.1');
    expect(MERMAID_DIAGRAM_FAMILIES).toHaveLength(30);
    expect(STARTER_TEMPLATES).toHaveLength(7);
    expect(STARTER_TEMPLATE_ALIASES).toHaveLength(6);
    expect(PRIMARY_STARTER_TEMPLATES).toHaveLength(31);
    expect(CHOOSER_STARTER_TEMPLATES).toBe(PRIMARY_STARTER_TEMPLATES);
    expect(ALL_STARTER_TEMPLATES).toHaveLength(37);
    expect(STARTER_TEMPLATES.map((template) => template.id)).toEqual([
      'blank',
      'api-sequence', 'service-flowchart', 'data-model-er', 'state-machine', 'incident-timeline', 'deployment-architecture',
    ]);
    expect(STARTER_TEMPLATES.map(({ id, label, defaultName, description, diagramType, source }) => ({ id, label, defaultName, description, diagramType, source }))).toEqual([
      { id: 'blank', label: 'Blank sheet', defaultName: 'Untitled diagram', description: 'An empty Mermaid sheet for a diagram you want to sketch from scratch.', diagramType: 'blank', source: '' },
      { id: 'api-sequence', label: 'End-to-end API sequence', defaultName: 'API sequence', description: 'A request, response, and failure-path conversation between a client and API.', diagramType: 'sequenceDiagram', source: 'sequenceDiagram\n  autonumber\n  participant Client\n  participant API\n  participant Service\n  Client->>API: POST /orders\n  API->>Service: create order\n  Service-->>API: order created\n  API-->>Client: 201 Created\n  alt validation fails\n    API-->>Client: 422 Validation error\n  end' },
      { id: 'service-flowchart', label: 'Service / system flowchart', defaultName: 'Service flow', description: 'A flowchart for the main request path through a service boundary.', diagramType: 'flowchart', source: 'flowchart LR\n  Client[Client] --> Gateway[API gateway]\n  Gateway --> Service[Application service]\n  Service --> Database[(Primary database)]' },
      { id: 'data-model-er', label: 'Data model / ER diagram', defaultName: 'Data model', description: 'A starter entity relationship model with a parent and child record.', diagramType: 'erDiagram', source: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  CUSTOMER {\n    string id PK\n    string email\n  }\n  ORDER {\n    string id PK\n    string customer_id FK\n    string status\n  }' },
      { id: 'state-machine', label: 'State machine', defaultName: 'State machine', description: 'A state transition model for a healthy, degraded, and recovered service.', diagramType: 'stateDiagram-v2', source: 'stateDiagram-v2\n  [*] --> Healthy\n  Healthy --> Degraded: alert\n  Degraded --> Healthy: recovered\n  Degraded --> [*]: retired' },
      { id: 'incident-timeline', label: 'Incident timeline', defaultName: 'Incident timeline', description: 'A concise incident response timeline from alert through recovery.', diagramType: 'timeline', source: 'timeline\n  title Incident response\n  2026 : Alert fires\n       : On-call acknowledges\n  2027 : Mitigation deployed\n       : Service recovered' },
      { id: 'deployment-architecture', label: 'Deployment architecture', defaultName: 'Deployment architecture', description: 'A deployable service topology using supported flowchart syntax.', diagramType: 'flowchart', source: 'flowchart TB\n  Browser[Browser] --> CDN[CDN]\n  CDN --> API[API service]\n  API --> Queue[(Job queue)]\n  API --> Database[(Primary database)]\n  Worker[Worker] --> Queue\n  Worker --> Database' },
    ]);
    expect(PRIMARY_STARTER_TEMPLATES.map((template) => template.id)).toEqual([
      'blank',
      ...MERMAID_DIAGRAM_FAMILIES.map((family) => family.starter.id),
    ]);
    expect(new Set(ALL_STARTER_TEMPLATES.map((template) => template.id)).size).toBe(ALL_STARTER_TEMPLATES.length);
    expect(getStarterTemplate('sequence')).toMatchObject({ diagramType: 'sequence', familyId: 'sequence' });
    expect(getStarterTemplate('missing')).toBeUndefined();
    expect(getStarterTemplate('api-sequence')).toMatchObject({ diagramType: 'sequenceDiagram', source: expect.stringContaining('autonumber') });
    expect(getStarterTemplate('service-flowchart')).toMatchObject({ source: expect.stringContaining('API gateway') });
    expect(getStarterTemplate('data-model-er')).toMatchObject({ diagramType: 'erDiagram', source: expect.stringContaining('CUSTOMER ||--o{ ORDER') });
    expect(getStarterTemplate('state-machine')).toMatchObject({ diagramType: 'stateDiagram-v2', source: expect.stringContaining('Degraded') });
    expect(getStarterTemplate('incident-timeline')).toMatchObject({ source: expect.stringContaining('On-call acknowledges') });
    expect(getStarterTemplate('deployment-architecture')).toMatchObject({ source: expect.stringContaining('CDN') });
    expect(Object.isFrozen(STARTER_TEMPLATES)).toBe(true);
    expect(Object.isFrozen(STARTER_TEMPLATES[0])).toBe(true);
  });

  it('keeps parser aliases, descriptors, and generated starters in one-to-one correspondence', () => {
    expect(new Set(MERMAID_DIAGRAM_FAMILIES.map((family) => family.id)).size).toBe(MERMAID_DIAGRAM_FAMILIES.length);
    expect(new Set(MERMAID_DIAGRAM_FAMILIES.map((family) => family.starter.id)).size).toBe(MERMAID_DIAGRAM_FAMILIES.length);
    for (const family of MERMAID_DIAGRAM_FAMILIES) {
      expect(family.availability).toBe('available');
      expect(family.help.trim()).not.toBe('');
      expect(family.parserTypes).not.toHaveLength(0);
      expect(PRIMARY_STARTER_TEMPLATES.find((template) => template.id === family.starter.id)).toMatchObject({
        diagramType: family.id,
        editingModel: family.editingModel,
        familyId: family.id,
        source: family.starter.source,
        stability: family.stability,
      });
      for (const parserType of family.parserTypes) expect(getMermaidDiagramFamily(parserType)).toBe(family);
    }
    expect(EXTERNAL_MERMAID_PLUGIN_FAMILIES).toEqual([
      expect.objectContaining({ availability: 'unavailable-plugin', id: 'zenuml', label: 'ZenUML' }),
    ]);
    expect(getStarterTemplate('zenuml')).toBeUndefined();
  });

  it('leaves only Blank empty and detect-parses every generated starter with the pinned Mermaid runtime', async () => {
    const blankTemplates = PRIMARY_STARTER_TEMPLATES.filter((template) => template.source === '');
    expect(blankTemplates).toEqual([PRIMARY_STARTER_TEMPLATES[0]]);

    mermaid.initialize({ startOnLoad: false });
    for (const template of PRIMARY_STARTER_TEMPLATES.filter((candidate) => candidate.source)) {
      const parserType = mermaid.detectType(template.source);
      const parsed = await mermaid.parse(template.source);
      expect(parsed.diagramType, template.id).toBe(parserType);
    }
  }, 30_000);
});
