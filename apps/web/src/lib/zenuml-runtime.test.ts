// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import mermaid from 'mermaid';
import { classifyDiagramCapability } from './diagram-capabilities';
import { DiagramPreviewRegistry } from './diagram-preview';
import { createZenUmlRuntime, getZenUmlRuntimePresentation, getZenUmlRuntimeSnapshot, isZenUmlSource, prepareMermaidRuntimeForSource, ZENUML_CORE_VERSION, ZENUML_PLUGIN_VERSION } from './zenuml-runtime';

describe('ZenUML bundled runtime', () => {
  it('recognizes only the ZenUML top-level parser, including frontmatter', () => {
    expect(isZenUmlSource('zenuml\n  A.B()')).toBe(true);
    expect(isZenUmlSource('  zenuml\r\n  A.B()')).toBe(true);
    expect(isZenUmlSource('---\ntitle: Checkout\n---\nzenuml\n  A.B()')).toBe(true);
    expect(isZenUmlSource('sequenceDiagram\n  A->>B: hello')).toBe(false);
    expect(isZenUmlSource('flowchart TD\n  zenuml --> B')).toBe(false);
    expect(prepareMermaidRuntimeForSource('flowchart TD\n  A --> B')).toBeUndefined();
    expect(getZenUmlRuntimeSnapshot()).toEqual({ status: 'idle' });
  });

  it('coalesces concurrent registration and publishes one ready transition', async () => {
    let resolveLoad!: (plugin: { default: never }) => void;
    const load = vi.fn(() => new Promise<{ default: never }>((resolve) => { resolveLoad = resolve; }));
    const register = vi.fn(async () => undefined);
    const runtime = createZenUmlRuntime(load, register);
    const states: string[] = [];
    runtime.subscribe(() => { states.push(runtime.getSnapshot().status); });

    const first = runtime.ensureRegistered();
    const second = runtime.ensureRegistered();
    expect(first).toBe(second);
    expect(runtime.getSnapshot()).toEqual({ status: 'loading' });
    resolveLoad({ default: {} as never });
    await first;

    expect(load).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['loading', 'ready']);
    expect(runtime.getSnapshot()).toEqual({ status: 'ready' });
  });

  it('retains a load failure and never retries or re-registers implicitly', async () => {
    const load = vi.fn(async () => { throw new Error('chunk blocked'); });
    const register = vi.fn(async () => undefined);
    const runtime = createZenUmlRuntime(load, register);

    await expect(runtime.ensureRegistered()).rejects.toThrow('ZenUML plugin unavailable: chunk blocked');
    await expect(runtime.ensureRegistered()).rejects.toThrow('ZenUML plugin unavailable: chunk blocked');
    expect(load).toHaveBeenCalledTimes(1);
    expect(register).not.toHaveBeenCalled();
    expect(runtime.getSnapshot()).toEqual({ error: 'chunk blocked', status: 'load-failed' });
    expect(getZenUmlRuntimePresentation('zenuml\n  A->B: hi', { error: 'chunk blocked', status: 'load-failed' }))
      .toEqual({ loading: false, modeLabel: 'ZenUML · plugin unavailable' });
    expect(getZenUmlRuntimePresentation('zenuml\n  A->B: hi', { status: 'loading' }))
      .toEqual({ loading: true, modeLabel: 'ZenUML · loading plugin' });

    const previews = new DiagramPreviewRegistry();
    const lastValid = { capability: classifyDiagramCapability('flowchart'), diagramId: 'diagram-1', flowchartSnapshot: null, source: 'flowchart TD\n  A-->B', svg: '<svg />' };
    previews.set(lastValid);
    previews.setError('diagram-1', 'ZenUML plugin unavailable: chunk blocked');
    expect(previews.get('diagram-1')).toBe(lastValid);
    expect(previews.getError('diagram-1')).toBe('ZenUML plugin unavailable: chunk blocked');
  });

  it('pins and registers the bundled detector against Mermaid 11.16.1', async () => {
    expect(ZENUML_PLUGIN_VERSION).toBe('0.2.3');
    expect(ZENUML_CORE_VERSION).toBe('3.50.1');
    mermaid.initialize({ startOnLoad: false });
    const source = 'zenuml\n  Client->API: request';
    await prepareMermaidRuntimeForSource(source);
    expect(mermaid.detectType(source)).toBe('zenuml');
    await expect(mermaid.parse(source)).resolves.toMatchObject({ diagramType: 'zenuml' });
    mermaid.initialize({ startOnLoad: false, theme: 'dark' });
    await expect(mermaid.parse(source)).resolves.toMatchObject({ diagramType: 'zenuml' });
  });
});
