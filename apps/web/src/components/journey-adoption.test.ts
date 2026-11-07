import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MERMAID_DIAGRAM_FAMILIES, EXTERNAL_MERMAID_PLUGIN_FAMILIES } from '@arielcharts/shared';
const source = readFileSync(new URL('./diagram-canvas.tsx', import.meta.url), 'utf8');
const semantic = source.slice(source.indexOf('function SequenceEditorControls'), source.indexOf('function ToolbarButton'));
describe('catalog-wide native presentation adoption', () => {
  it('registers the actual journey browser gate in the existing workspace UX CI phase', () => {
    const scripts = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')).scripts;
    const ci = readFileSync(new URL('../../../../.github/workflows/ci.yml', import.meta.url), 'utf8');
    expect(scripts['test:e2e-journey-audit']).toBe('tsx e2e-journey-audit-validate.ts');
    expect(ci.slice(ci.indexOf('  workspace-ux:'), ci.indexOf('  protected-collaboration:'))).toContain('pnpm test:e2e-journey-audit');
  });
  it('requires every family to retain its actual panel owner', () => {
    for (const family of [...MERMAID_DIAGRAM_FAMILIES, ...EXTERNAL_MERMAID_PLUGIN_FAMILIES]) {
      const id = family.id === 'tree-view' ? 'treeview' : family.id === 'xy-chart' ? 'xychart' : family.id;
      if (id === 'flowchart') expect(source).toContain('canvas-node-toolbar');
      else expect(source, family.id).toContain(`data-testid="${id === 'entity-relationship' ? 'er' : id}-editor-controls"`);
    }
    expect(semantic).toContain('c4-containment-controls'); expect(semantic).toContain('block-containment-controls');
  });
  it('does not leave native controls or record geometry bypassing shared owners', () => {
    expect(source).not.toMatch(/<(button|input|select|textarea)\b/);
    expect(semantic).not.toContain('SEMANTIC_PANEL_STYLE');
    expect(semantic).not.toMatch(/style=\{\{[^}]*\b(gap|padding|borderRadius|fontSize):/);
  });
});
