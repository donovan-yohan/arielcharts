import { chromium } from '@playwright/test';

async function validate() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const results: Array<{ test: string; pass: boolean }> = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[console.error] ${msg.text()}`);
  });

  console.log('1. Loading page...');
  await page.goto('http://localhost:3003/s/e2e-diag01', { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('.cm-content', { timeout: 15000 });
  await page.waitForTimeout(2000);

  console.log('2. Typing flowchart...');
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Meta+a');
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
    const overlays = document.querySelectorAll('.diagram-node-target');

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
  const firstOverlay = page.locator('.diagram-node-target').first();
  await firstOverlay.click({ timeout: 5000 });
  await page.waitForTimeout(300);
  const toolbarVisible = await page.evaluate(() => {
    return document.querySelectorAll('button[aria-label="Edit label"]').length > 0;
  });
  results.push({ test: 'node click toolbar', pass: toolbarVisible });
  console.log(`   Toolbar appeared: ${toolbarVisible} — ${toolbarVisible ? 'PASS' : 'FAIL'}`);
  await page.screenshot({ path: '/tmp/arielcharts-click.png' });

  // --- Test: add node ---
  console.log('\n6. Testing add node...');
  const nodeCountBefore = await page.locator('.diagram-node-target').count();
  console.log(`   Nodes before: ${nodeCountBefore}`);

  // Click "Add node" button on the toolbar
  await page.locator('button[aria-label="Add node"]').click({ timeout: 5000 });
  // Wait for mermaid to re-render with the new node
  await page.waitForTimeout(3000);

  const nodeCountAfter = await page.locator('.diagram-node-target').count();
  console.log(`   Nodes after: ${nodeCountAfter}`);

  // Verify the editor text now contains the new node
  const editorText = await page.locator('.cm-content').textContent();
  const hasNewNode = editorText?.includes('New Node') ?? false;
  console.log(`   Editor contains "New Node": ${hasNewNode}`);

  const addNodePass = nodeCountAfter > nodeCountBefore && hasNewNode;
  results.push({ test: 'add node', pass: addNodePass });
  console.log(`   ${addNodePass ? 'PASS' : 'FAIL'}`);
  await page.screenshot({ path: '/tmp/arielcharts-addnode.png' });

  // --- Test: new node overlay alignment ---
  console.log('\n7. Checking new node overlay alignment...');
  const newAlignment = await page.evaluate(() => {
    const svg = document.querySelector('.diagram-canvas-svg svg') as SVGSVGElement | null;
    if (!svg) return { error: 'no svg' };

    const nodes = svg.querySelectorAll('g.node');
    const overlays = document.querySelectorAll('.diagram-node-target');

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
}

validate().catch(console.error);
