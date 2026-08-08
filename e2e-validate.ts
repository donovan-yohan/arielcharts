import { existsSync } from 'node:fs';
import { chromium, type Locator, type Page } from '@playwright/test';
import { createRoom, exchangeRoomAccess, roomShareUrl } from './e2e/support/room-access';
import { openYjsSessionObserver } from './e2e/support/yjs-session';

interface SemanticState {
  circleMarker: string | null;
  crossMarker: string | null;
  cylinderAria: string | null;
  cylinderPseudoRadius: string;
  dottedDasharray: string | null;
  edgeOpacity: string | null;
  edgePaths: number;
  openMarker: string | null;
  reactFlowEdges: number;
  thickStrokeWidth: string | null;
}

interface ManualLayoutEdgeState {
  mermaidEdgeOpacity: string | null;
  reactFlowEdgeHeight: number;
  reactFlowEdges: number;
  reactFlowEdgeWidth: number;
}

function nodeTargetLocator(page: Page): Locator {
  return page.locator('.mermaid-flow-node[role="button"], .diagram-node-target');
}

async function clickFirstNodeTarget(page: Page) {
  await nodeTargetLocator(page).first().click({ timeout: 5000 });
}

async function ensureSourceFlyoutOpen(page: Page): Promise<Locator> {
  const toggle = page.getByTestId('source-flyout-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') {
    await toggle.click();
  }

  const editor = page.locator('.cm-content');
  await editor.waitFor({ state: 'visible', timeout: 15000 });
  return editor;
}

async function clickFirstVisibleEdge(page: Page): Promise<boolean> {
  const point = await page.evaluate(() => {
    const edges = Array.from(document.querySelectorAll('.react-flow__edge'));

    for (const edge of edges) {
      const path = edge.querySelector('.react-flow__edge-interaction, .react-flow__edge-path') as SVGGeometryElement | null;
      const matrix = path?.getScreenCTM();
      const totalLength = path && 'getTotalLength' in path ? path.getTotalLength() : 0;

      if (path && matrix && totalLength > 0) {
        for (const ratio of [0.2, 0.35, 0.65, 0.8, 0.5]) {
          const pathPoint = path.getPointAtLength(totalLength * ratio);
          const x = (pathPoint.x * matrix.a) + (pathPoint.y * matrix.c) + matrix.e;
          const y = (pathPoint.x * matrix.b) + (pathPoint.y * matrix.d) + matrix.f;
          const hit = document.elementFromPoint(x, y);

          if (hit?.closest('.react-flow__edge') === edge) {
            return { x, y };
          }
        }
      }

      const bounds = edge.getBoundingClientRect();
      if (bounds.width > 0 || bounds.height > 0) {
        return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
      }
    }

    return null;
  });

  if (!point) {
    return false;
  }

  await page.mouse.click(point.x, point.y);
  return true;
}

async function validate() {
  const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({ executablePath: chromiumPath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const results: Array<{ test: string; pass: boolean }> = [];
  const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:3003';
  const mcpUrl = process.env.E2E_MCP_URL ?? 'http://localhost:4000/mcp';
  const room = await createRoom(new URL(mcpUrl).origin, baseUrl);
  const roomAccess = await exchangeRoomAccess(new URL(mcpUrl).origin, baseUrl, room);
  const durableObserver = await openYjsSessionObserver(mcpUrl, room.sessionId, { cookie: roomAccess.cookie, origin: baseUrl });

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[console.error] ${msg.text()}`);
  });

  console.log('1. Loading page...');
  await page.goto(roomShareUrl(baseUrl, room), { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await ensureSourceFlyoutOpen(page);
  await page.waitForTimeout(2000);
  const editor = page.locator('.cm-content');

  console.log('2. Checking empty-canvas builder...');
  const emptyBuilderVisible = await page.locator('button', { hasText: 'Add your first node' }).isVisible({ timeout: 5000 });
  results.push({ test: 'empty canvas shows first-node builder', pass: emptyBuilderVisible });
  console.log(`   Empty first-node builder visible: ${emptyBuilderVisible} — ${emptyBuilderVisible ? 'PASS' : 'FAIL'}`);
  await page.locator('button', { hasText: 'Add your first node' }).click({ timeout: 5000 });
  await page.waitForTimeout(3000);
  const emptyBuilderEditorText = await editor.textContent();
  const emptyBuilderCreated = (emptyBuilderEditorText?.includes('flowchart') ?? false)
    && (emptyBuilderEditorText?.includes('New Node') ?? false)
    && (await page.locator('.react-flow__node, .diagram-node-target').count()) > 0;
  results.push({ test: 'empty canvas first node creates mermaid text', pass: emptyBuilderCreated });
  console.log(`   Empty builder created Mermaid text: ${emptyBuilderCreated} — ${emptyBuilderCreated ? 'PASS' : 'FAIL'}`);

  console.log('2b. Typing flowchart...');
  await ensureSourceFlyoutOpen(page);
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(`flowchart TD
    A[Start] --> B{Bug?}
    B -->|Yes| C[Fix]
    B -->|No| D[Ship]`, { delay: 10 });
  await page.waitForTimeout(3000);

  // --- Test: overlay alignment ---
  console.log('\n3. Checking overlay alignment...');
  const alignment = await page.evaluate(() => {
    const svg = document.querySelector('.diagram-canvas-svg svg') as SVGSVGElement | null;
    if (!svg) return { error: 'no svg' };

    const nodes = svg.querySelectorAll('g.node');
    const overlays = document.querySelectorAll('.react-flow__node, .diagram-node-target');

    const matches: Array<{ nodeId: string; svgCenter: string; overlayCenter: string; offsetPx: number }> = [];
    nodes.forEach((n, i) => {
      const g = n as SVGGElement;
      const overlay = overlays[i] as HTMLElement | undefined;
      if (!overlay) return;

      const svgRect = g.getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();

      const svgCx = Math.round(svgRect.x + svgRect.width / 2);
      const svgCy = Math.round(svgRect.y + svgRect.height / 2);
      const overlayCx = Math.round(overlayRect.x + overlayRect.width / 2);
      const overlayCy = Math.round(overlayRect.y + overlayRect.height / 2);

      matches.push({
        nodeId: g.id,
        svgCenter: `${svgCx},${svgCy}`,
        overlayCenter: `${overlayCx},${overlayCy}`,
        offsetPx: Math.round(Math.sqrt((svgCx - overlayCx) ** 2 + (svgCy - overlayCy) ** 2)),
      });
    });

    return { svgNodes: nodes.length, overlays: overlays.length, matches };
  });

  const maxOffset = Math.max(0, ...((alignment as any).matches ?? []).map((m: any) => m.offsetPx));
  const alignPass = maxOffset <= 5;
  results.push({ test: 'overlay alignment', pass: alignPass });
  console.log(`   Max offset: ${maxOffset}px — ${alignPass ? 'PASS' : 'FAIL'}`);

  // --- Test: canonical Mermaid edge semantics + React Flow shape fidelity ---
  console.log('\n3b. Checking Mermaid semantics in React Flow mode...');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(`flowchart TD
    A[(Database)] --> B{Decision}
    B -.-> C[Retry]
    B ==>|thick| D[Done]
    A --o E((Circle))
    E --x F[/Trap/]
    C --- G[Open]`, { delay: 10 });
  await page.waitForTimeout(3000);

  const semanticState = await page.evaluate<SemanticState>(() => {
    const svg = document.querySelector('.diagram-canvas-svg--reactflow svg') as SVGSVGElement | null;
    const edgePath = svg?.querySelector('path.flowchart-link') as SVGPathElement | null;
    const cylinder = document.querySelector('.mermaid-flow-node--cylinder') as HTMLElement | null;
    const reactFlowEdges = Array.from(document.querySelectorAll('.react-flow__edge'));
    const edgePaths = reactFlowEdges
      .map((edge) => edge.querySelector('path.react-flow__edge-path') as SVGPathElement | null)
      .filter((path): path is SVGPathElement => path !== null);
    const circleEdge = edgePaths.find((path) => path.getAttribute('marker-end')?.includes('circle')) ?? null;
    const crossEdge = edgePaths.find((path) => path.getAttribute('marker-end')?.includes('cross')) ?? null;
    const openEdge = edgePaths.find((path) => {
      const marker = path.getAttribute('marker-end') ?? '';
      return marker.includes('type=arrow') && !marker.includes('arrowclosed');
    }) ?? null;
    const dottedEdge = edgePaths.find((path) => window.getComputedStyle(path).strokeDasharray !== 'none') ?? null;
    const thickEdge = edgePaths.find((path) => Number.parseFloat(window.getComputedStyle(path).strokeWidth) >= 3) ?? null;

    return {
      circleMarker: circleEdge?.getAttribute('marker-end') ?? null,
      crossMarker: crossEdge?.getAttribute('marker-end') ?? null,
      cylinderAria: cylinder?.getAttribute('aria-label') ?? null,
      cylinderPseudoRadius: cylinder ? window.getComputedStyle(cylinder, '::before').borderRadius : '',
      dottedDasharray: dottedEdge ? window.getComputedStyle(dottedEdge).strokeDasharray : null,
      edgeOpacity: edgePath ? window.getComputedStyle(edgePath).opacity : null,
      edgePaths: svg?.querySelectorAll('path.flowchart-link').length ?? 0,
      openMarker: openEdge?.getAttribute('marker-end') ?? null,
      reactFlowEdges: reactFlowEdges.length,
      thickStrokeWidth: thickEdge ? window.getComputedStyle(thickEdge).strokeWidth : null,
    };
  });
  const edgeSemanticsPass = semanticState.edgePaths >= 6
    && semanticState.edgeOpacity === '0'
    && semanticState.reactFlowEdges >= 6
    && !!semanticState.circleMarker
    && !!semanticState.crossMarker
    && !!semanticState.openMarker
    && !!semanticState.dottedDasharray
    && !!semanticState.thickStrokeWidth;
  results.push({ test: 'reactflow edges preserve mermaid markers and stroke styles', pass: edgeSemanticsPass });
  console.log(`   Mermaid edge paths: ${semanticState.edgePaths}, React Flow edges: ${semanticState.reactFlowEdges}, Mermaid opacity: ${semanticState.edgeOpacity} — ${edgeSemanticsPass ? 'PASS' : 'FAIL'}`);
  console.log(`   Markers circle/cross/open: ${semanticState.circleMarker}/${semanticState.crossMarker}/${semanticState.openMarker}; dotted=${semanticState.dottedDasharray}; thick=${semanticState.thickStrokeWidth}`);

  const shapeFidelityPass = typeof semanticState.cylinderAria === 'string'
    && semanticState.cylinderAria.includes('cylinder:')
    && semanticState.cylinderPseudoRadius.includes('%');
  results.push({ test: 'reactflow cylinder shape fidelity', pass: shapeFidelityPass });
  console.log(`   Cylinder aria: ${semanticState.cylinderAria}, pseudo radius: ${semanticState.cylinderPseudoRadius} — ${shapeFidelityPass ? 'PASS' : 'FAIL'}`);

  await page.keyboard.press('Escape');
  await ensureSourceFlyoutOpen(page);
  await editor.focus();
  let keyboardFocusState: {
    activeLabel: string | null;
    activeRole: string | null;
    focusedInner: boolean;
    focusedWrapper: boolean;
  } | null = null;
  for (let index = 0; index < 24; index += 1) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(50);
    const state = await page.evaluate(() => {
      const activeElement = document.activeElement as HTMLElement | null;

      return {
        activeLabel: activeElement?.getAttribute('aria-label') ?? null,
        activeRole: activeElement?.getAttribute('role') ?? null,
        focusedInner: activeElement?.matches('.mermaid-flow-node[role="button"]') ?? false,
        focusedWrapper: activeElement?.classList.contains('react-flow__node') ?? false,
      };
    });
    if (state.activeLabel?.includes('Database')) {
      keyboardFocusState = state;
      break;
    }
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const keyboardToolbarVisible = await page.locator('button[aria-label="Edit label"]').count();
  const keyboardPass = keyboardToolbarVisible > 0
    && keyboardFocusState?.focusedInner === true
    && keyboardFocusState.focusedWrapper === false;
  results.push({ test: 'reactflow node keyboard selection', pass: keyboardPass });
  console.log(`   Keyboard focus ${keyboardFocusState?.activeRole}/${keyboardFocusState?.activeLabel}, toolbar opened: ${keyboardToolbarVisible > 0} — ${keyboardPass ? 'PASS' : 'FAIL'}`);

  const sideHandleState = await page.evaluate(() => ({
    leftSources: document.querySelectorAll('.mermaid-flow-handle--left.mermaid-flow-handle--source').length,
    rightSources: document.querySelectorAll('.mermaid-flow-handle--right.mermaid-flow-handle--source').length,
  }));
  const sideHandlesPass = sideHandleState.leftSources > 0 && sideHandleState.rightSources > 0;
  results.push({ test: 'reactflow exposes left/right drag-out handles', pass: sideHandlesPass });
  console.log(`   Side handles L/R: ${sideHandleState.leftSources}/${sideHandleState.rightSources} — ${sideHandlesPass ? 'PASS' : 'FAIL'}`);

  // --- Test: fit-to-diagram ---
  console.log('\n4. Testing fit-to-diagram...');
  await page.locator('button[aria-label="Fit diagram"]').click();
  await page.waitForTimeout(500);
  const zoomText = await page.locator('span').filter({ hasText: /^\d+%$/ }).first().textContent();
  const fitPass = !!zoomText;
  results.push({ test: 'fit-to-diagram', pass: fitPass });
  console.log(`   Zoom after fit: ${zoomText} — ${fitPass ? 'PASS' : 'FAIL'}`);
  await page.screenshot({ path: '/tmp/arielcharts-fit.png' });

  // --- Test: node click / toolbar ---
  console.log('\n5. Testing node click...');
  await clickFirstNodeTarget(page);
  await page.waitForTimeout(300);
  const toolbarVisible = await page.evaluate(() => {
    return document.querySelectorAll('button[aria-label="Edit label"]').length > 0;
  });
  results.push({ test: 'node click toolbar', pass: toolbarVisible });
  console.log(`   Toolbar appeared: ${toolbarVisible} — ${toolbarVisible ? 'PASS' : 'FAIL'}`);
  await page.screenshot({ path: '/tmp/arielcharts-click.png' });

  // --- Test: React Flow drag + reset layout ---
  console.log('\n6. Testing React Flow drag/reset...');
  const dragTarget = nodeTargetLocator(page).first();
  const beforeDragEditorText = await editor.textContent();
  const beforeDragZoomText = await page.locator('span').filter({ hasText: /^\d+%$/ }).first().textContent();
  const beforeDrag = await dragTarget.boundingBox();
  if (beforeDrag) {
    await page.mouse.move(beforeDrag.x + beforeDrag.width / 2, beforeDrag.y + beforeDrag.height / 2);
    await page.mouse.down();
    await page.mouse.move(beforeDrag.x + beforeDrag.width / 2 + 260, beforeDrag.y + beforeDrag.height / 2 + 40, { steps: 16 });
    await page.mouse.up();
  }
  await page.waitForTimeout(500);
  const afterDrag = await dragTarget.boundingBox();
  const afterDragEditorText = await editor.textContent();
  const afterDragZoomText = await page.locator('span').filter({ hasText: /^\d+%$/ }).first().textContent();
  const dragMoved = !!beforeDrag && !!afterDrag && Math.abs(afterDrag.x - beforeDrag.x) > 20;
  const dragKeptMermaidText = afterDragEditorText === beforeDragEditorText;
  const dragKeptZoom = afterDragZoomText === beforeDragZoomText;
  results.push({ test: 'reactflow drag nodes', pass: dragMoved });
  results.push({ test: 'reactflow drag keeps mermaid text canonical', pass: dragKeptMermaidText });
  results.push({ test: 'reactflow drag does not change zoom', pass: dragKeptZoom });
  console.log(`   Node moved: ${dragMoved} — ${dragMoved ? 'PASS' : 'FAIL'}`);
  console.log(`   Mermaid text unchanged by drag: ${dragKeptMermaidText} — ${dragKeptMermaidText ? 'PASS' : 'FAIL'}`);
  console.log(`   Zoom before/after drag: ${beforeDragZoomText}/${afterDragZoomText} — ${dragKeptZoom ? 'PASS' : 'FAIL'}`);

  const manualEdgeState = await page.evaluate<ManualLayoutEdgeState>(() => {
    const mermaidEdgePath = document.querySelector('.diagram-canvas-svg--reactflow path.flowchart-link') as SVGPathElement | null;
    const reactFlowEdgePath = document.querySelector('.react-flow__edge path.react-flow__edge-path') as SVGPathElement | null;
    const reactFlowEdgeBounds = reactFlowEdgePath?.getBoundingClientRect();

    return {
      mermaidEdgeOpacity: mermaidEdgePath ? window.getComputedStyle(mermaidEdgePath).opacity : null,
      reactFlowEdgeHeight: Math.round(reactFlowEdgeBounds?.height ?? 0),
      reactFlowEdges: document.querySelectorAll('.react-flow__edge').length,
      reactFlowEdgeWidth: Math.round(reactFlowEdgeBounds?.width ?? 0),
    };
  });
  const manualEdgesPass = manualEdgeState.mermaidEdgeOpacity === '0'
    && manualEdgeState.reactFlowEdges > 0
    && (manualEdgeState.reactFlowEdgeWidth > 0 || manualEdgeState.reactFlowEdgeHeight > 0);
  results.push({ test: 'manual layout edges follow React Flow nodes', pass: manualEdgesPass });
  console.log(`   Manual layout edges: RF=${manualEdgeState.reactFlowEdges}, Mermaid opacity=${manualEdgeState.mermaidEdgeOpacity}, bbox=${manualEdgeState.reactFlowEdgeWidth}x${manualEdgeState.reactFlowEdgeHeight} — ${manualEdgesPass ? 'PASS' : 'FAIL'}`);

  const resetButton = page.locator('button[aria-label="Reset shared layout to Mermaid"]');
  const hasResetButton = await resetButton.count() > 0;
  let resetPass = false;
  if (hasResetButton) {
    await resetButton.click({ timeout: 5000 });
    await page.waitForTimeout(500);
    const afterReset = await dragTarget.boundingBox();
    resetPass = !!beforeDrag && !!afterReset && Math.abs(afterReset.x - beforeDrag.x) <= 5;
  }
  results.push({ test: 'reactflow reset layout', pass: resetPass });
  console.log(`   Node reset: ${resetPass} — ${resetPass ? 'PASS' : 'FAIL'}`);

  // --- Test: fixed add-node toolbar ---
  console.log('\n7. Testing fixed add-node toolbar...');
  const toolbarCountBefore = await nodeTargetLocator(page).count();
  await page.locator('input[aria-label="New node label"]').fill('UI Node');
  await page.locator('select[aria-label="New node shape"]').selectOption('round');
  await page.locator('button[aria-label="Add node to Mermaid text"]').click({ timeout: 5000 });
  await page.waitForTimeout(3000);
  const toolbarCountAfter = await nodeTargetLocator(page).count();
  const toolbarEditorText = await page.locator('.cm-content').textContent();
  const fixedToolbarPass = toolbarCountAfter > toolbarCountBefore && (toolbarEditorText?.includes('UI Node') ?? false);
  results.push({ test: 'fixed add-node toolbar', pass: fixedToolbarPass });
  console.log(`   Nodes before/after: ${toolbarCountBefore}/${toolbarCountAfter}`);
  console.log(`   Editor contains "UI Node": ${toolbarEditorText?.includes('UI Node') ?? false}`);
  console.log(`   Fixed toolbar added node: ${fixedToolbarPass} — ${fixedToolbarPass ? 'PASS' : 'FAIL'}`);

  // --- Test: node label edit syncs to Mermaid text ---
  console.log('\n8. Testing node label edit sync...');
  await clickFirstNodeTarget(page);
  await page.locator('button[aria-label="Edit label"]').click({ timeout: 5000 });
  await page.locator('input[placeholder="node label"]').fill('Launch');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  const editedText = await page.locator('.cm-content').textContent();
  const editSyncPass = editedText?.includes('Launch') ?? false;
  results.push({ test: 'node label edit sync', pass: editSyncPass });
  console.log(`   Editor contains edited label: ${editSyncPass} — ${editSyncPass ? 'PASS' : 'FAIL'}`);

  // --- Test: edge select/edit/delete ---
  console.log('\n8b. Testing edge select/edit/delete...');
  const edgeCountBeforeEdit = await page.locator('.react-flow__edge').count();
  const edgeClicked = await clickFirstVisibleEdge(page);
  await page.waitForTimeout(300);
  const edgeToolbarVisible = edgeClicked && await page.locator('div[aria-label="Selected edge toolbar"]').isVisible({ timeout: 5000 });
  if (edgeToolbarVisible) {
    await page.locator('button[aria-label="Edit edge label"]').click({ timeout: 5000 });
    await page.locator('input[aria-label="Edge label"]').fill('Critical');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
  }
  const edgeLabelText = await page.locator('.cm-content').textContent();
  const edgeLabelPass = edgeToolbarVisible && (edgeLabelText?.includes('Critical') ?? false);
  results.push({ test: 'edge label edit sync', pass: edgeLabelPass });
  console.log(`   Edge toolbar visible: ${edgeToolbarVisible}, editor contains Critical: ${edgeLabelText?.includes('Critical') ?? false} — ${edgeLabelPass ? 'PASS' : 'FAIL'}`);

  // Editing the Mermaid source rerenders the controlled edge layer, so select
  // the visible edge again before exercising its destructive action.
  const edgeReselected = await clickFirstVisibleEdge(page);
  if (!edgeReselected) throw new Error('No visible edge could be reselected after its label was edited.');
  await page.locator('div[aria-label="Selected edge toolbar"]').waitFor({ state: 'visible', timeout: 5000 });

  await page.locator('button[aria-label="Delete selected edge"]').click({ timeout: 5000 });
  await page.waitForTimeout(2000);
  const edgeCountAfterDelete = await page.locator('.react-flow__edge').count();
  const edgeDeletePass = edgeCountAfterDelete < edgeCountBeforeEdit;
  results.push({ test: 'edge click delete', pass: edgeDeletePass });
  console.log(`   Edges before/after delete: ${edgeCountBeforeEdit}/${edgeCountAfterDelete} — ${edgeDeletePass ? 'PASS' : 'FAIL'}`);

  // --- Test: add node ---
  console.log('\n9. Testing add node...');
  const nodeCountBefore = await nodeTargetLocator(page).count();
  console.log(`   Nodes before: ${nodeCountBefore}`);

  // Click "Add node" button on the node toolbar
  await clickFirstNodeTarget(page);
  await page.locator('button[aria-label="Add node"]').click({ timeout: 5000 });
  // Wait for mermaid to re-render with the new node
  await page.waitForTimeout(3000);

  const nodeCountAfter = await nodeTargetLocator(page).count();
  console.log(`   Nodes after: ${nodeCountAfter}`);

  // Verify the editor text now contains the new node
  const editorText = await page.locator('.cm-content').textContent();
  const hasNewNode = editorText?.includes('New Node') ?? false;
  console.log(`   Editor contains "New Node": ${hasNewNode}`);

  const addNodePass = nodeCountAfter > nodeCountBefore && hasNewNode;
  results.push({ test: 'add node', pass: addNodePass });
  console.log(`   ${addNodePass ? 'PASS' : 'FAIL'}`);
  await page.screenshot({ path: '/tmp/arielcharts-addnode.png' });

  // --- Test: drag connector to create connected node ---
  console.log('\n9b. Testing drag-out connected node creation...');
  const connectedNodeCountBefore = await page.locator('.react-flow__node').count();
  const connectedEdgeCountBefore = await page.locator('.react-flow__edge').count();
  const connectedFlowNodeIdsBefore = await page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id') ?? ''));
  const sourceHandle = page.locator('.mermaid-flow-handle--right.mermaid-flow-handle--source').first();
  const sourceBox = await sourceHandle.boundingBox();
  let intendedDropPoint: { x: number; y: number } | null = null;
  let viewportBeforeConnectedNode: string | null = null;
  if (sourceBox) {
    const startX = sourceBox.x + sourceBox.width / 2;
    const startY = sourceBox.y + sourceBox.height / 2;
    intendedDropPoint = { x: startX + 220, y: startY + 120 };
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(intendedDropPoint.x, intendedDropPoint.y, { steps: 12 });
    viewportBeforeConnectedNode = await page.locator('.react-flow__viewport').getAttribute('style');
    await page.mouse.up();
    await page.waitForFunction(
      ({ edgeCount, nodeCount }) => (
        document.querySelectorAll('.react-flow__node').length > nodeCount
        && document.querySelectorAll('.react-flow__edge').length > edgeCount
      ),
      { edgeCount: connectedEdgeCountBefore, nodeCount: connectedNodeCountBefore },
      { timeout: 10_000 },
    );
  }
  const connectedNodeCountAfter = await page.locator('.react-flow__node').count();
  const connectedEdgeCountAfter = await page.locator('.react-flow__edge').count();
  const connectedFlowNodeIdsAfter = await page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id') ?? ''));
  const manuallyPositionedFlowNodeIds = connectedFlowNodeIdsAfter.filter((id) => !connectedFlowNodeIdsBefore.includes(id));
  const manuallyPositionedFlowNodeId = manuallyPositionedFlowNodeIds.length === 1
    ? manuallyPositionedFlowNodeIds[0]!
    : null;
  if (manuallyPositionedFlowNodeId) {
    await durableObserver.waitFor(
      (observer) => observer.hasNodePosition('main', manuallyPositionedFlowNodeId),
      `a durable node position for drag-created node ${manuallyPositionedFlowNodeId}`,
      10_000,
    );
    await page.waitForFunction(
      (nodeId) => [...document.querySelectorAll('.diagram-canvas-svg svg g.node')]
        .some((node) => node.id.includes(`flowchart-${nodeId}-`)),
      manuallyPositionedFlowNodeId,
      { timeout: 10_000 },
    );
  }
  const connectedSvgNodeIdsAfter = await page.locator('.diagram-canvas-svg svg g.node').evaluateAll((nodes) => nodes.map((node) => node.id));
  // Mermaid's DOM prefix changes on every source render, but the tail retains
  // the canonical flow-node id that React Flow exposes as data-id.
  const manuallyPositionedSvgNodeIds = manuallyPositionedFlowNodeIds.flatMap((nodeId) => (
    connectedSvgNodeIdsAfter.filter((svgId) => svgId.includes(`flowchart-${nodeId}-`))
  ));
  const manuallyPositionedNode = manuallyPositionedFlowNodeId
    ? page.locator(`.react-flow__node[data-id=${JSON.stringify(manuallyPositionedFlowNodeId)}]`)
    : null;
  const manuallyPositionedNodeBox = await manuallyPositionedNode?.boundingBox() ?? null;
  const manualNodeDropOffset = intendedDropPoint && manuallyPositionedNodeBox
    ? Math.hypot(
      manuallyPositionedNodeBox.x + manuallyPositionedNodeBox.width / 2 - intendedDropPoint.x,
      manuallyPositionedNodeBox.y + manuallyPositionedNodeBox.height / 2 - intendedDropPoint.y,
    )
    : Number.POSITIVE_INFINITY;
  const manualNodeGeometry = await page.evaluate(() => {
    const canvas = document.querySelector('[aria-label="Interactive diagram canvas"]')?.getBoundingClientRect();
    const viewport = document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? null;
    return {
      canvas: canvas ? { height: canvas.height, left: canvas.left, top: canvas.top, width: canvas.width } : null,
      viewport,
    };
  });
  // A drag-created node keeps its intentional durable placement rather than
  // Mermaid's hidden auto-layout position; allow only sub-handle rounding.
  const manuallyPositionedNodeAtDrop = manualNodeDropOffset <= 8;
  const dragOutCameraStable = viewportBeforeConnectedNode !== null && viewportBeforeConnectedNode === manualNodeGeometry.viewport;
  const durableManualPosition = manuallyPositionedFlowNodeId
    ? durableObserver.snapshot('main').nodePositions[manuallyPositionedFlowNodeId] ?? null
    : null;
  const dragOutPass = !!sourceBox
    && connectedNodeCountAfter > connectedNodeCountBefore
    && connectedEdgeCountAfter > connectedEdgeCountBefore
    && manuallyPositionedFlowNodeIds.length === 1
    && manuallyPositionedSvgNodeIds.length === 1
    && durableManualPosition !== null
    && manuallyPositionedNodeAtDrop
    && dragOutCameraStable;
  results.push({ test: 'drag connector creates connected ghost node', pass: dragOutPass });
  results.push({ test: 'drag connector preserves camera', pass: dragOutCameraStable });
  console.log(`   Nodes before/after: ${connectedNodeCountBefore}/${connectedNodeCountAfter}`);
  console.log(`   Edges before/after: ${connectedEdgeCountBefore}/${connectedEdgeCountAfter}`);
  console.log(`   New React Flow/SVG ids: ${manuallyPositionedFlowNodeIds.join(',')}/${manuallyPositionedSvgNodeIds.join(',')}`);
  console.log(`   Drop geometry: ${JSON.stringify({ drop: intendedDropPoint, node: manuallyPositionedNodeBox, ...manualNodeGeometry })}`);
  console.log(`   Durable new-node position: ${JSON.stringify(durableManualPosition)}`);
  console.log(`   New node drop offset: ${Math.round(manualNodeDropOffset)}px — ${manuallyPositionedNodeAtDrop ? 'PASS' : 'FAIL'}`);
  console.log(`   Drag-out camera stable: ${dragOutCameraStable} — ${dragOutCameraStable ? 'PASS' : 'FAIL'}`);
  console.log(`   Drag-out connected node: ${dragOutPass ? 'PASS' : 'FAIL'}`);

  // --- Test: new node overlay alignment ---
  console.log('\n10. Checking new node overlay alignment...');
  const newAlignment = await page.evaluate(({ manuallyPositionedFlowNodeIds: manualFlowIds, manuallyPositionedSvgNodeIds: manualSvgIds }) => {
    const svg = document.querySelector('.diagram-canvas-svg svg') as SVGSVGElement | null;
    if (!svg) return { error: 'no svg' };

    const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')].filter((node) => !manualSvgIds.includes(node.id));
    const overlays = [...document.querySelectorAll<HTMLElement>('.react-flow__node, .diagram-node-target')]
      .filter((node) => !manualFlowIds.includes(node.dataset.id ?? ''));
    const remainingOverlays = overlays.map((overlay, index) => ({ index, rect: overlay.getBoundingClientRect() }));
    const matches: Array<{ nodeId: string; offsetPx: number }> = [];

    for (const node of nodes) {
      const svgRect = node.getBoundingClientRect();
      const svgCenter = { x: svgRect.x + svgRect.width / 2, y: svgRect.y + svgRect.height / 2 };
      let nearestIndex = -1;
      let nearestOffset = Number.POSITIVE_INFINITY;

      remainingOverlays.forEach((overlay, index) => {
        const overlayCenter = { x: overlay.rect.x + overlay.rect.width / 2, y: overlay.rect.y + overlay.rect.height / 2 };
        const offset = Math.hypot(svgCenter.x - overlayCenter.x, svgCenter.y - overlayCenter.y);
        if (offset < nearestOffset) {
          nearestIndex = index;
          nearestOffset = offset;
        }
      });

      if (nearestIndex >= 0) {
        matches.push({ nodeId: node.id, offsetPx: Math.round(nearestOffset) });
        remainingOverlays.splice(nearestIndex, 1);
      }
    }

    return { svgNodes: nodes.length, overlays: overlays.length, unmatchedOverlays: remainingOverlays.length, matches };
  }, { manuallyPositionedFlowNodeIds, manuallyPositionedSvgNodeIds });

  const newMaxOffset = Math.max(0, ...((newAlignment as any).matches ?? []).map((m: any) => m.offsetPx));
  const newAlignmentCountsMatch = (newAlignment as any).svgNodes > 0
    && (newAlignment as any).svgNodes === (newAlignment as any).overlays
    && (newAlignment as any).matches?.length === (newAlignment as any).svgNodes
    && (newAlignment as any).unmatchedOverlays === 0;
  const newAlignPass = newAlignmentCountsMatch && newMaxOffset <= 5;
  results.push({ test: 'new node alignment', pass: newAlignPass });
  console.log(`   Nodes: ${(newAlignment as any).svgNodes}, Overlays: ${(newAlignment as any).overlays}`);
  console.log(`   One-to-one pairs: ${(newAlignment as any).matches?.length ?? 0}, unmatched overlays: ${(newAlignment as any).unmatchedOverlays ?? 0}`);
  console.log(`   Max offset: ${newMaxOffset}px — ${newAlignPass ? 'PASS' : 'FAIL'}`);

  // --- Summary ---
  console.log('\n' + '='.repeat(40));
  const allPassed = results.every((r) => r.pass);
  for (const r of results) {
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.test}`);
  }
  console.log('='.repeat(40));
  console.log(allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');

  await browser.close();
  durableObserver.destroy();

  if (!allPassed) {
    process.exit(1);
  }
}

validate().catch((error) => {
  console.error(error);
  process.exit(1);
});
