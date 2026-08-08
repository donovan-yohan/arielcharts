import { describe, expect, it } from 'vitest';
import { getDefaultMermaidText, isValidSessionId, randomSessionId } from './session';
import { getActiveDiagramName, getAgentWorkflowPrompt } from '../components/session-workspace';

describe('session helpers', () => {
  it('creates session ids in the expected shape', () => {
    expect(randomSessionId()).toMatch(/^[a-z0-9]{8}$/);
  });

  it('validates supported session ids', () => {
    expect(isValidSessionId('a7x9k2mn')).toBe(true);
    expect(isValidSessionId('bad id')).toBe(false);
  });

  it('returns starter mermaid text', () => {
    expect(getDefaultMermaidText()).toContain('flowchart LR');
  });

  it('copies a modern MCP prompt that requires a fresh revision before writes', () => {
    const prompt = getAgentWorkflowPrompt('abc123de', 'https://charts.test/mcp');
    expect(prompt).toContain('getSession');
    expect(prompt).toContain('readDiagram');
    expect(prompt).toContain('writeDiagram');
    expect(prompt).toContain('expectedRevision');
    expect(prompt).not.toContain('get_session');
  });

  it('reads active-tab metadata from the latest diagram catalog without changing its ID', () => {
    const activeId = 'main';
    expect(getActiveDiagramName([{ id: activeId, name: 'Main' }], activeId)).toBe('Main');
    expect(getActiveDiagramName([{ id: activeId, name: 'API request flow' }], activeId)).toBe('API request flow');
  });
});
