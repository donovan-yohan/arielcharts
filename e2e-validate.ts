import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

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

async function validate() {
  const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({ executablePath: chromiumPath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const results: Array<{ test: string; pass: boolean }> = [];
  const sessionName = `e2e-diag-${Date.now()}`;

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[console.error] ${msg.text()}`);
  });

  console.log('1. Loading page...');
  await page.goto(`http://localhost:3003/s/${sessionName}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.cm-content', { timeout: 15000 });
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
    const reactFlowEdges = [...document.querySelectorAll('.react-flow__edge')];
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

  const firstFlowNode = page.locator('.mermaid-flow-node[role="button"]').first();
  await firstFlowNode.focus({ timeout: 5000 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const keyboardToolbarVisible = await page.locator('button[aria-label="Edit label"]').count();
  const keyboardPass = keyboardToolbarVisible > 0;
  results.push({ test: 'reactflow node keyboard selection', pass: keyboardPass });
  console.log(`   Keyboard opened toolbar: ${keyboardPass} — ${keyboardPass ? 'PASS' : 'FAIL'}`);

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
  const firstOverlay = page.locator('.react-flow__node, .diagram-node-target').first();
  await firstOverlay.click({ timeout: 5000 });
  await page.waitForTimeout(300);
  const toolbarVisible = await page.evaluate(() => {
    return document.querySelectorAll('button[aria-label="Edit label"]').length > 0;
  });
  results.push({ test: 'node click toolbar', pass: toolbarVisible });
  console.log(`   Toolbar appeared: ${toolbarVisible} — ${toolbarVisible ? 'PASS' : 'FAIL'}`);
  await page.screenshot({ path: '/tmp/arielcharts-click.png' });

  // --- Test: React Flow drag + reset layout ---
  console.log('\n6. Testing React Flow drag/reset...');
  const dragTarget = page.locator('.react-flow__node, .diagram-node-target').first();
  const beforeDragEditorText = await editor.textContent();
  const beforeDrag = await dragTarget.boundingBox();
  if (beforeDrag) {
    await page.mouse.move(beforeDrag.x + beforeDrag.width / 2, beforeDrag.y + beforeDrag.height / 2);
    await page.mouse.down();
    await page.mouse.move(beforeDrag.x + beforeDrag.width / 2 + 90, beforeDrag.y + beforeDrag.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
  }
  await page.waitForTimeout(500);
  const afterDrag = await dragTarget.boundingBox();
  const afterDragEditorText = await editor.textContent();
  const dragMoved = !!beforeDrag && !!afterDrag && Math.abs(afterDrag.x - beforeDrag.x) > 20;
  const dragKeptMermaidText = afterDragEditorText === beforeDragEditorText;
  results.push({ test: 'reactflow drag nodes', pass: dragMoved });
  results.push({ test: 'reactflow drag keeps mermaid text canonical', pass: dragKeptMermaidText });
  console.log(`   Node moved: ${dragMoved} — ${dragMoved ? 'PASS' : 'FAIL'}`);
  console.log(`   Mermaid text unchanged by drag: ${dragKeptMermaidText} — ${dragKeptMermaidText ? 'PASS' : 'FAIL'}`);

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

  const resetButton = page.locator('button[aria-label="Clean layout to Mermaid"]');
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
  const toolbarCountBefore = await page.locator('.react-flow__node, .diagram-node-target').count();
  await page.locator('input[aria-label="New node label"]').fill('UI Node');
  await page.locator('select[aria-label="New node shape"]').selectOption('round');
  await page.locator('button[aria-label="Add node to Mermaid text"]').click({ timeout: 5000 });
  await page.waitForTimeout(3000);
  const toolbarCountAfter = await page.locator('.react-flow__node, .diagram-node-target').count();
  const toolbarEditorText = await page.locator('.cm-content').textContent();
  const fixedToolbarPass = toolbarCountAfter > toolbarCountBefore && (toolbarEditorText?.includes('UI Node') ?? false);
  results.push({ test: 'fixed add-node toolbar', pass: fixedToolbarPass });
  console.log(`   Nodes before/after: ${toolbarCountBefore}/${toolbarCountAfter}`);
  console.log(`   Editor contains "UI Node": ${toolbarEditorText?.includes('UI Node') ?? false}`);
  console.log(`   Fixed toolbar added node: ${fixedToolbarPass} — ${fixedToolbarPass ? 'PASS' : 'FAIL'}`);

  // --- Test: node label edit syncs to Mermaid text ---
  console.log('\n8. Testing node label edit sync...');
  await page.locator('.react-flow__node, .diagram-node-target').first().click({ timeout: 5000 });
  await page.locator('button[aria-label="Edit label"]').click({ timeout: 5000 });
  await page.locator('input[placeholder="node label"]').fill('Launch');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  const editedText = await page.locator('.cm-content').textContent();
  const editSyncPass = editedText?.includes('Launch') ?? false;
  results.push({ test: 'node label edit sync', pass: editSyncPass });
  console.log(`   Editor contains edited label: ${editSyncPass} — ${editSyncPass ? 'PASS' : 'FAIL'}`);

  // --- Test: add node ---
  console.log('\n9. Testing add node...');
  const nodeCountBefore = await page.locator('.react-flow__node, .diagram-node-target').count();
  console.log(`   Nodes before: ${nodeCountBefore}`);

  // Click "Add node" button on the node toolbar
  await page.locator('.react-flow__node, .diagram-node-target').first().click({ timeout: 5000 });
  await page.locator('button[aria-label="Add node"]').click({ timeout: 5000 });
  // Wait for mermaid to re-render with the new node
  await page.waitForTimeout(3000);

  const nodeCountAfter = await page.locator('.react-flow__node, .diagram-node-target').count();
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
  const sourceHandle = page.locator('.react-flow__handle.source').first();
  const sourceBox = await sourceHandle.boundingBox();
  if (sourceBox) {
    const startX = sourceBox.x + sourceBox.width / 2;
    const startY = sourceBox.y + sourceBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 220, startY + 120, { steps: 12 });
    await page.mouse.up();
  }
  await page.waitForTimeout(3000);
  const connectedNodeCountAfter = await page.locator('.react-flow__node').count();
  const connectedEdgeCountAfter = await page.locator('.react-flow__edge').count();
  const dragOutPass = !!sourceBox
    && connectedNodeCountAfter > connectedNodeCountBefore
    && connectedEdgeCountAfter > connectedEdgeCountBefore;
  results.push({ test: 'drag connector creates connected ghost node', pass: dragOutPass });
  console.log(`   Nodes before/after: ${connectedNodeCountBefore}/${connectedNodeCountAfter}`);
  console.log(`   Edges before/after: ${connectedEdgeCountBefore}/${connectedEdgeCountAfter}`);
  console.log(`   Drag-out connected node: ${dragOutPass ? 'PASS' : 'FAIL'}`);

  // --- Test: new node overlay alignment ---
  console.log('\n10. Checking new node overlay alignment...');
  const newAlignment = await page.evaluate(() => {
    const svg = document.querySelector('.diagram-canvas-svg svg') as SVGSVGElement | null;
    if (!svg) return { error: 'no svg' };

    const nodes = svg.querySelectorAll('g.node');
    const overlays = document.querySelectorAll('.react-flow__node, .diagram-node-target');

    const matches: Array<{ nodeId: string; offsetPx: number }> = [];
    nodes.forEach((n, i) => {
      const g = n as SVGGElement;
      const overlay = overlays[i] as HTMLElement | undefined;
      if (!overlay) return;

      const svgRect = g.getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();

      matches.push({
        nodeId: g.id,
        offsetPx: Math.round(Math.sqrt(
          (svgRect.x + svgRect.width / 2 - overlayRect.x - overlayRect.width / 2) ** 2 +
          (svgRect.y + svgRect.height / 2 - overlayRect.y - overlayRect.height / 2) ** 2,
        )),
      });
    });

    return { svgNodes: nodes.length, overlays: overlays.length, matches };
  });

  const newMaxOffset = Math.max(0, ...((newAlignment as any).matches ?? []).map((m: any) => m.offsetPx));
  const newAlignPass = newMaxOffset <= 5;
  results.push({ test: 'new node alignment', pass: newAlignPass });
  console.log(`   Nodes: ${(newAlignment as any).svgNodes}, Overlays: ${(newAlignment as any).overlays}`);
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

  if (!allPassed) {
    process.exit(1);
  }
}

validate().catch((error) => {
  console.error(error);
  process.exit(1);
});
