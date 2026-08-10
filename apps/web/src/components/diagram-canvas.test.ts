import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DiagramLink } from '../lib/diagram-mutations';
import type { MermaidPresentation } from '../lib/mermaid-presentation';
import type { SvgHitMap } from '../lib/svg-hit-map';
import { getCanvasEdgeMarker } from '../lib/mermaid-presentation';
import { getConnectModeSourceId } from '../lib/diagram-connect-state';
import { areMermaidPresentationsEqual, areSvgHitMapsEqual, CANVAS_PAN_EXCLUSION_SELECTOR, getCanvasHistoryShortcut, getCanonicalSelectionAttribute, getFlowEdgePresentation, getFlowSelectionChange, getGraphMembershipKey, getNodeClickSelection, getRendererInteractionMode, isSameNodeSelection, shouldEnableCanvasMarquee, shouldHandleCanvasShortcut, shouldHandleCanvasSingleKeyShortcut, shouldHandleGlobalCanvasRenameShortcut, shouldRestoreCanvasFocusAfterPaste } from './diagram-canvas';

const canvasSource = readFileSync(new URL('./diagram-canvas.tsx', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('./session-workspace.tsx', import.meta.url), 'utf8');

describe('canvas cursor callback lifecycle', () => {
  it('withdraws cursor and editing presence only on true canvas unmount and keeps preview gating behind a stable publisher ref', () => {
    expect(canvasSource).toMatch(/onCanvasCursorChangeRef\.current = onCanvasCursorChange;[^]*?onNodeEditingChangeRef\.current = onNodeEditingChange;[^]*?useEffect\(\(\) => \(\) => \{\s*onCanvasCursorChangeRef\.current\?\.\(null\);\s*onNodeEditingChangeRef\.current\?\.\(null\);\s*\}, \[\]\);/u);
    expect(workspaceSource).toMatch(/historyPreviewRef\.current = historyPreview;[^]*?if \(!collaboration \|\| !diagramId \|\| historyPreviewRef\.current !== null\)[^]*?\}, \[collaboration\]\);/u);
  });

  it('derives remote edit indicators independently from selection and clears a removed edited node', () => {
    expect(canvasSource).toMatch(/const remoteEditorsByNodeId = useMemo/u);
    expect(canvasSource).toMatch(/remoteEditors: remoteEditorsByNodeId\.get\(node\.id\) \?\? \[\]/u);
    expect(canvasSource).toMatch(/if \(editingNodeId && !nodeById\.has\(editingNodeId\)\) \{\s*setEditingNodeId\(null\);/u);
    expect(canvasSource).toMatch(/if \(readOnly && editingNodeId\) \{\s*setEditingNodeId\(null\);/u);
    expect(canvasSource).not.toMatch(/cancelNodeEditWhenInactive/u);
    expect(workspaceSource).toMatch(/if \(connectionState === 'reconnecting' \|\| connectionState === 'disconnected'\) \{\s*clearCanvasPresence\(true\);/u);
    expect(workspaceSource).toMatch(/historyPreview !== null \|\| connectionState === 'disconnected'/u);
    expect(workspaceSource).toMatch(/window\.addEventListener\('focus', resumeCanvasPresence\);/u);
    expect(canvasSource).toMatch(/data-testid=\{remoteEditor \? `remote-node-editing-\$\{id\}` : `remote-node-selection-\$\{id\}`\}/u);
    expect(canvasSource).toMatch(/!presence\.canvas\.editing_node_id \? \(\s*<span/u);
  });
});

describe('canvas pan exclusions', () => {
  it('keeps complete forms and marked overlays out of touch, middle-mouse, and Space pan starts', () => {
    expect(CANVAS_PAN_EXCLUSION_SELECTOR).toContain('form');
    expect(CANVAS_PAN_EXCLUSION_SELECTOR).toContain('[data-canvas-pan-exclusion="true"]');
    expect(CANVAS_PAN_EXCLUSION_SELECTOR).toContain('[data-subgraph-drag-target="true"]');
    expect(canvasSource).toMatch(/return !target\.closest\(CANVAS_PAN_EXCLUSION_SELECTOR\);/u);
    expect(canvasSource).toMatch(/className="diagram-canvas-shell"[^]*?<div[^]*?data-testid="diagram-canvas"[^]*?touchAction: 'none'/u);
    expect(canvasSource).toMatch(/<form className="canvas-sequence-participant-form" data-canvas-pan-exclusion="true"/u);
  });
});

describe('ER editor safe area', () => {
  it('keeps the semantic form above the measured canvas controls toolbar', () => {
    expect(canvasSource).toMatch(/const erEditorBottom = canvasToolbarStack\.bottom \+ controlsToolbarHeight \+ BOTTOM_TOOLBAR_GAP;/u);
    expect(canvasSource).toMatch(/<ErEditorControls\s+bottom=\{erEditorBottom\}/u);
    expect(canvasSource).toMatch(/function ErEditorControls\(\{\s+bottom,/u);
    expect(canvasSource).toMatch(/canvas-er-editor[^]*?bottom,/u);
  });
});

describe('relationship and architecture semantic editors', () => {
  it('shares only the measured panel shell while keeping family-specific form controls separate', () => {
    expect(canvasSource).toMatch(/data-testid="class-editor-controls"/u);
    expect(canvasSource).toMatch(/data-testid="state-editor-controls"/u);
    expect(canvasSource).toMatch(/data-testid="requirement-editor-controls"/u);
    expect(canvasSource).toMatch(/ClassRelationshipForm[^]*?Class relationship type/u);
    expect(canvasSource).toMatch(/Class relationship type[^]*?CLASS_RELATION_OPTIONS\.map/u);
    expect(canvasSource).toMatch(/Class \$\{entity\.name\} id/u);
    expect(canvasSource).toMatch(/StateTransitionForm[^]*?State transition source[^]*?State transition target/u);
    expect(canvasSource).toMatch(/State \$\{state\.id\} id/u);
    expect(canvasSource).toMatch(/const endpoints = \[\.\.\.new Set\(states\.map\(\(state\) => state\.id\)\)\]/u);
    expect(canvasSource).toMatch(/RequirementRelationshipForm[^]*?Requirement relationship type/u);
    expect(canvasSource).toMatch(/getClassRelationshipIdentity\(item, index, diagram\.relationships\)/u);
    expect(canvasSource).toMatch(/getStateTransitionIdentity\(item, index, diagram\.transitions\)/u);
    expect(canvasSource).toMatch(/getRequirementRelationshipIdentity\(item, index, diagram\.relationships\)/u);
    expect(canvasSource).toMatch(/const nextRequirementId = Math\.max\(0, \.\.\.diagram\.entities\.map/u);
    expect(canvasSource).toMatch(/id: String\(nextRequirementId\)/u);
    expect(canvasSource).toMatch(/const \[name, setName\] = useState\('req'\)/u);
    expect(workspaceSource).toMatch(/canUseSemanticFamilyControls\(renderedMermaidText, renderedPreview, 'class'\)/u);
    expect(workspaceSource).toMatch(/canUseSemanticFamilyControls\(renderedMermaidText, renderedPreview, 'state'\)/u);
    expect(workspaceSource).toMatch(/canUseSemanticFamilyControls\(renderedMermaidText, renderedPreview, 'requirement'\)/u);
    expect(workspaceSource).toMatch(/mutateCanvasSource\(\(source\) => addClass/u);
    expect(workspaceSource).toMatch(/mutateCanvasSource\(\(source\) => addState/u);
    expect(workspaceSource).toMatch(/mutateCanvasSource\(\(source\) => addRequirement/u);
    expect(workspaceSource).toMatch(/canUseSemanticFamilyControls\(renderedMermaidText, renderedPreview, 'architecture'\)/u);
    expect(workspaceSource).toMatch(/mutateCanvasSource\(\(source\) => addArchitectureService/u);
    expect(canvasSource).toMatch(/data-testid="architecture-editor-controls"/u);
    expect(canvasSource).toMatch(/Architecture group \$\{group\.id\} editor[^]*?Architecture group \$\{group\.id\} title/u);
    expect(canvasSource).toMatch(/data-testid="c4-editor-controls"/u);
    expect(canvasSource).toMatch(/data-testid="block-editor-controls"/u);
    expect(canvasSource).toMatch(/data-testid="swimlane-editor-controls"/u);
    expect(canvasSource).toMatch(/C4 <small>experimental safe subset/u);
    expect(canvasSource).toMatch(/Block <small>beta safe subset/u);
    expect(canvasSource).toMatch(/Swimlane <small>beta safe subset/u);
    expect(workspaceSource).toMatch(/canUseSemanticFamilyControls\(renderedMermaidText, renderedPreview, 'c4'\)/u);
    expect(workspaceSource).toMatch(/canUseSemanticFamilyControls\(renderedMermaidText, renderedPreview, 'block'\)/u);
    expect(workspaceSource).toMatch(/canUseSemanticFamilyControls\(renderedMermaidText, renderedPreview, 'swimlane'\)/u);
    expect(workspaceSource).toMatch(/mutateCanvasSource\(\(source\) => addC4Element/u);
    expect(workspaceSource).toMatch(/mutateCanvasSource\(\(source\) => addBlockNode/u);
    expect(workspaceSource).toMatch(/mutateCanvasSource\(\(source\) => addSwimlaneNode/u);
    expect(canvasSource).toMatch(/onSave\?\.\(group\.id, draft\)/u);
    expect(canvasSource).toMatch(/Architecture service \$\{service\.id\} editor[^]*?Architecture service \$\{service\.id\} title/u);
    expect(canvasSource).toMatch(/onSave\?\.\(service\.id, draft\)/u);
    expect(canvasSource).toMatch(/Architecture junction \$\{junction\.id\} editor[^]*?Architecture junction \$\{junction\.id\} parent/u);
    expect(canvasSource).toMatch(/onSave\?\.\(junction\.id, draft\)/u);
    expect(canvasSource).toMatch(/Architecture edge \$\{signature\} editor[^]*?Architecture edge \$\{signature\} source port[^]*?Architecture edge \$\{signature\} target port/u);
    expect(canvasSource).toMatch(/Architecture alignment \$\{signature\} editor[^]*?Architecture alignment \$\{signature\} members/u);
    expect(canvasSource).toMatch(/data-testid="c4-containment-controls"[^]*?C4 boundary \$\{boundary\.id\} parent/u);
    expect(canvasSource).toMatch(/data-testid="block-containment-controls"[^]*?Block composite \$\{composite\.id\} parent/u);
  });
});

describe('sequence semantic editor', () => {
  it('keeps every representable statement family behind explicit semantic controls', () => {
    expect(canvasSource).toMatch(/New sequence participant kind/u);
    expect(canvasSource).toMatch(/Sequence message sender[^]*?Sequence message recipient[^]*?Sequence message arrow[^]*?Sequence message text/u);
    expect(canvasSource).toMatch(/Sequence note placement[^]*?Sequence note targets[^]*?Sequence note text/u);
    expect(canvasSource).toMatch(/Sequence activation action[^]*?Sequence activation participant/u);
    expect(canvasSource).toMatch(/Sequence fragment label/u);
    expect(canvasSource).toMatch(/onDeleteActivation[^]*?onMoveActivation[^]*?onEditActivation/u);
    expect(workspaceSource).toMatch(/onEditSequenceMessage[^]*?editSequenceMessage/u);
    expect(workspaceSource).toMatch(/onEditSequenceNote[^]*?editSequenceNote/u);
    expect(workspaceSource).toMatch(/onEditSequenceActivation[^]*?editSequenceActivation/u);
    expect(workspaceSource).toMatch(/onEditSequenceFragment[^]*?editSequenceFragment/u);
  });
});

describe('canvas blank-click selection ownership', () => {
  it('clears app-owned selection from both the generic canvas click and the React Flow pane while keeping focus roving-only', () => {
    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
    expect(canvasSource).toMatch(/const handleCanvasClick = useCallback\(\(\) => \{[^]*?setSelection\(\[\]\);/u);
    expect(canvasSource).toMatch(/const handleFlowPaneClick = useCallback\(\(event: ReactMouseEvent\) => \{\s*event\.stopPropagation\(\);\s*handleCanvasClick\(\);/u);
    expect(canvasSource).toMatch(/onPaneClick=\{handleFlowPaneClick\}/u);
    expect(canvasSource).toMatch(/event\.currentTarget\.matches\(':focus-visible'\)/u);
    expect(canvasSource).not.toMatch(/is-focused/u);
    expect(css).toMatch(/\.diagram-node-target:focus-visible\s*\{[^}]*outline:/u);
    expect(css).toMatch(/\.mermaid-flow-node:focus-visible \.mermaid-flow-node-surface/u);
  });
});

describe('canvas wheel ownership', () => {
  it('uses a non-passive native listener so canvas pan and pinch can suppress browser zoom', () => {
    expect(canvasSource).toMatch(/container\.addEventListener\('wheel', handleCanvasWheel, \{ passive: false \}\);/u);
    expect(canvasSource).toMatch(/container\.addEventListener\('gesturechange', handleSafariGestureChange, \{ passive: false \}\);/u);
    expect(canvasSource).toMatch(/event\.preventDefault\(\);[^]*?getCanvasWheelGesture\(event/u);
    expect(canvasSource).not.toMatch(/onWheel=\{handleWheel\}/u);
    expect(canvasSource).toMatch(/function canHandleCanvasWheel[^]*?return !target\.closest\(CANVAS_PAN_EXCLUSION_SELECTOR\);/u);
  });

  it('keeps the focus ring available for keyboard navigation but hides it while a Space drag pans', () => {
    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
    expect(canvasSource).toMatch(/data-panning=\{spacePressed \|\| isPanning \|\| undefined\}/u);
    expect(css).toMatch(/\.diagram-canvas:focus-visible\s*\{[^}]*outline:/u);
    expect(css).toMatch(/\.diagram-canvas\[data-panning='true'\]:focus-visible\s*\{\s*outline:\s*none;/u);
  });
});

describe('getRendererInteractionMode', () => {
  it('leaves camera ownership separate while static previews clear connect mode', () => {
    expect(getRendererInteractionMode('connect', false)).toBe('select');
    expect(getRendererInteractionMode('connect', true)).toBe('connect');
    expect(getRendererInteractionMode('select', false)).toBe('select');
  });
});

describe('connect mode entry', () => {
  it('shares the selected-source contract between the toolbar and keyboard command', () => {
    expect(getConnectModeSourceId(['source'])).toBe('source');
    expect(getConnectModeSourceId(['source', 'target'])).toBeNull();
    expect(canvasSource).toMatch(/const toggleConnectMode = useCallback\(\(\) => \{[^]*?getConnectModeSourceId\(selectionRef\.current\)/u);
    expect(canvasSource).toMatch(/key === 'c'[^]*?toggleConnectMode\(\);/u);
    expect(canvasSource).toMatch(/label="Connect nodes"[^]*?toggleConnectMode\(\);/u);
  });
});

describe('React Flow handle directionality', () => {
  it('leaves sources as connection starts and targets as connection ends', () => {
    expect(canvasSource).toMatch(/mermaid-flow-handle--\$\{position\} mermaid-flow-handle--target[^]*?isConnectableStart=\{false\}/u);
    expect(canvasSource).toMatch(/mermaid-flow-handle--\$\{position\} mermaid-flow-handle--source[^]*?isConnectableEnd=\{false\}/u);
  });
});

describe('flyout viewport measurement', () => {
  it('defers mutation-triggered measurements until the flyout layout frame settles', () => {
    expect(canvasSource).toMatch(/const mutationObserver = new MutationObserver\(\(\) => \{\s*observeFlyouts\(\);\s*scheduleViewportUpdate\(\);\s*\}\);/u);
  });
});

describe('getCanonicalSelectionAttribute', () => {
  it('keeps one stable app-owned snapshot across preview entry and exit', () => {
    const selected = ['Browser', 'API'];
    const beforePreview = getCanonicalSelectionAttribute(selected);
    const duringDetachedPreview = getCanonicalSelectionAttribute(selected);
    const afterCancel = getCanonicalSelectionAttribute(selected);

    expect(beforePreview).toBe('["API","Browser"]');
    expect(duringDetachedPreview).toBe(beforePreview);
    expect(afterCancel).toBe(beforePreview);
  });
});

describe('getGraphMembershipKey', () => {
  it('does not retrigger SVG-derived state for equivalent parser array identities', () => {
    expect(getGraphMembershipKey(['B', 'A'], ['group-b', 'group-a']))
      .toBe(getGraphMembershipKey(['A', 'B'], ['group-a', 'group-b']));
    expect(getGraphMembershipKey(['A'], [])).not.toBe(getGraphMembershipKey(['A', 'B'], []));
  });
});

describe('SVG-derived state equality', () => {
  it('keeps equivalent SVG hit maps and presentation projections as no-ops', () => {
    const hitMap: SvgHitMap = {
      edges: new Map(),
      nodes: new Map([['A', { height: 24, width: 80, x: 12, y: 8 }]]),
      subgraphs: new Map(),
      viewBox: { height: 100, width: 200, x: 0, y: 0 },
    };
    const equivalentHitMap: SvgHitMap = {
      ...hitMap,
      nodes: new Map(hitMap.nodes),
    };
    const presentation: MermaidPresentation = {
      edges: [{ stroke: '#123' }],
      nodes: new Map([['A', { fill: '#fff', text: '#111' }]]),
    };
    const equivalentPresentation: MermaidPresentation = {
      edges: [{ stroke: '#123' }],
      nodes: new Map([['A', { fill: '#fff', text: '#111' }]]),
    };

    expect(areSvgHitMapsEqual(hitMap, equivalentHitMap)).toBe(true);
    expect(areMermaidPresentationsEqual(presentation, equivalentPresentation)).toBe(true);
    expect(areSvgHitMapsEqual(hitMap, { ...equivalentHitMap, nodes: new Map([['A', { height: 24, width: 80, x: 13, y: 8 }]]) })).toBe(false);
  });
});

describe('isSameNodeSelection', () => {
  it('treats React Flow selection callbacks with the same ids as a no-op', () => {
    expect(isSameNodeSelection(['B', 'A'], ['A', 'B'])).toBe(true);
    expect(isSameNodeSelection(['A'], ['A', 'B'])).toBe(false);
  });
});

describe('getFlowSelectionChange', () => {
  it('keeps intentional empty selection while ignoring callbacks from an unavailable or stale graph', () => {
    expect(getFlowSelectionChange([], ['A', 'B'])).toEqual([]);
    expect(getFlowSelectionChange([], [])).toBeNull();
    expect(getFlowSelectionChange([{ id: 'stale' }], ['A', 'B'])).toBeNull();
    expect(getFlowSelectionChange([{ id: 'A' }], ['A', 'B'])).toEqual(['A']);
  });
});

describe('getNodeClickSelection', () => {
  it('keeps ordinary and Shift selection in app-owned click handlers', () => {
    expect(getNodeClickSelection(['A'], 'B', false)).toEqual(['B']);
    expect(getNodeClickSelection(['A'], 'B', true)).toEqual(['A', 'B']);
    expect(getNodeClickSelection(['A', 'B'], 'A', true)).toEqual(['B']);
  });
});

describe('shouldHandleCanvasShortcut', () => {
  it('keeps canvas shortcuts out of source and other typing targets', () => {
    expect(shouldHandleCanvasShortcut(true, true, false)).toBe(true);
    expect(shouldHandleCanvasShortcut(false, false, false)).toBe(false);
    expect(shouldHandleCanvasShortcut(true, true, true)).toBe(false);
  });
});

describe('shouldHandleCanvasSingleKeyShortcut', () => {
  it('accepts canvas descendants while excluding typing and toolbar ownership', () => {
    expect(shouldHandleCanvasSingleKeyShortcut(true, true, false, false)).toBe(true);
    expect(shouldHandleCanvasSingleKeyShortcut(false, true, false, false)).toBe(false);
    expect(shouldHandleCanvasSingleKeyShortcut(true, false, false, false)).toBe(false);
    expect(shouldHandleCanvasSingleKeyShortcut(true, true, true, false)).toBe(false);
    expect(shouldHandleCanvasSingleKeyShortcut(true, true, false, true)).toBe(false);
  });
});

describe('shouldHandleGlobalCanvasRenameShortcut', () => {
  it('leaves F2 with a focused node or section instead of renaming a different selected node', () => {
    expect(shouldHandleGlobalCanvasRenameShortcut(false, true)).toBe(false);
    expect(shouldHandleGlobalCanvasRenameShortcut(true, false)).toBe(false);
    expect(shouldHandleGlobalCanvasRenameShortcut(false, false)).toBe(true);
  });
});

describe('getCanvasHistoryShortcut', () => {
  it('maps Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z without taking non-modifier Z', () => {
    expect(getCanvasHistoryShortcut('z', true, false)).toBe('undo');
    expect(getCanvasHistoryShortcut('Z', true, true)).toBe('redo');
    expect(getCanvasHistoryShortcut('z', false, false)).toBeNull();
    expect(getCanvasHistoryShortcut('y', true, false)).toBeNull();
  });
});

describe('shouldRestoreCanvasFocusAfterPaste', () => {
  it('restores repeated-paste focus only while no external surface owns it', () => {
    expect(shouldRestoreCanvasFocusAfterPaste(true, false)).toBe(true);
    expect(shouldRestoreCanvasFocusAfterPaste(false, true)).toBe(true);
    expect(shouldRestoreCanvasFocusAfterPaste(false, false)).toBe(false);
  });
});

describe('shouldEnableCanvasMarquee', () => {
  it('keeps drag selection desktop-only without changing touch click selection', () => {
    expect(shouldEnableCanvasMarquee(true, 'select', false)).toBe(true);
    expect(shouldEnableCanvasMarquee(true, 'select', true)).toBe(false);
    expect(shouldEnableCanvasMarquee(true, 'connect', false)).toBe(false);
    expect(shouldEnableCanvasMarquee(false, 'select', false)).toBe(false);
  });
});

describe('getFlowEdgePresentation', () => {
  it.each(['arrow_circle', 'arrow_cross'] as const)('uses authored stroke color for %s markers', (type) => {
    const link: DiagramLink = {
      length: 1,
      source: 'Browser',
      stroke: 'normal',
      target: 'API',
      type,
    };

    const presentation = getFlowEdgePresentation(link, { stroke: '#d9480f' });

    expect(presentation.markerEnd).toBe(getCanvasEdgeMarker(type, '#d9480f').id);
    expect(presentation.style?.stroke).toBe('#d9480f');
  });
});
