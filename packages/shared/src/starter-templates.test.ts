// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { getStarterTemplate, STARTER_TEMPLATES } from './starter-templates.js';

describe('starter templates', () => {
  it('keeps the seven stable templates in picker order', () => {
    expect(STARTER_TEMPLATES.map((template) => template.id)).toEqual([
      'blank',
      'api-sequence',
      'service-flowchart',
      'data-model-er',
      'state-machine',
      'incident-timeline',
      'deployment-architecture',
    ]);
    expect(new Set(STARTER_TEMPLATES.map((template) => template.label)).size).toBe(STARTER_TEMPLATES.length);
    expect(new Set(STARTER_TEMPLATES.map((template) => template.defaultName)).size).toBe(STARTER_TEMPLATES.length);
    expect(new Set(STARTER_TEMPLATES.map((template) => template.description)).size).toBe(STARTER_TEMPLATES.length);
    expect(new Set(STARTER_TEMPLATES.map((template) => template.source)).size).toBe(STARTER_TEMPLATES.length);
    expect(STARTER_TEMPLATES.map((template) => template.diagramType)).toEqual([
      'blank',
      'sequenceDiagram',
      'flowchart',
      'erDiagram',
      'stateDiagram-v2',
      'timeline',
      'flowchart',
    ]);
    expect(getStarterTemplate('api-sequence')).toMatchObject({ diagramType: 'sequenceDiagram' });
    expect(getStarterTemplate('missing')).toBeUndefined();
    expect(Object.isFrozen(STARTER_TEMPLATES)).toBe(true);
    expect(Object.isFrozen(STARTER_TEMPLATES[0])).toBe(true);
  });

  it('leaves only Blank empty and parses every starter with the pinned Mermaid runtime', async () => {
    const blankTemplates = STARTER_TEMPLATES.filter((template) => template.source === '');
    expect(blankTemplates).toEqual([STARTER_TEMPLATES[0]]);

    mermaid.initialize({ startOnLoad: false });
    for (const template of STARTER_TEMPLATES.filter((candidate) => candidate.source)) {
      await expect(mermaid.parse(template.source), template.id).resolves.toBeDefined();
    }
  });
});
