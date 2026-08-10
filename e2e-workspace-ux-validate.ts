import { expect, type Locator, type Page } from '@playwright/test';
import { WebsocketProvider } from 'y-websocket';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import {
  DESKTOP_VIEWPORT,
  MOBILE_LANDSCAPE_VIEWPORT,
  MOBILE_VIEWPORT,
  NARROW_MOBILE_VIEWPORT,
  TABLET_VIEWPORT,
  launchBrowserHarness,
  saveScreenshot,
  saveViewportScreenshot,
  type BrowserHarness,
} from './e2e/support/browser.ts';
import { assert, describeError } from './e2e/support/assert.ts';
import {
  assertAnchorsStable,
  assertContainedInViewport,
  assertContrastAtLeast,
  assertDocumentMatchesViewport,
  assertDocumentHasNoHorizontalOverflow,
  assertExactColor,
  assertHitTarget,
  assertNeutralColor,
  assertTouchTarget,
  snapshotAnchors,
  verifiedClick,
} from './e2e/support/interactions.ts';
import { ModernMcpClient, type DiagramRevision, type DiagramRevisionSummary } from './e2e/support/mcp.ts';
import { withOwnedServices } from './e2e/support/owned-services.ts';
import { createRoom, exchangeRoomAccess, type RoomAccess } from './e2e/support/room-access.ts';
import {
  getYjsSourceLayoutTransitions,
  openYjsSessionObserver,
  type YjsSessionSnapshot,
  type YjsSessionSnapshotHistory,
} from './e2e/support/yjs-session.ts';
import { STARTER_TEMPLATES } from './packages/shared/src/starter-templates.js';
import { getWebsocketServerUrl } from './apps/web/src/lib/session.ts';
import { getCanvasDotGridGeometry } from './apps/web/src/lib/canvas-dot-grid.ts';
import {
  API_SEQUENCE_FIXTURE,
  ER_DIAGRAM_FIXTURE,
  FLOWCHART_FIXTURE,
  INVALID_MERMAID_FIXTURE,
  activeTabName,
  canonicalSource,
  closeFlyout,
  createDiagramFromTemplate,
  ensureFlyout,
  ensureSourceFlyoutOpen,
  openTemplateMenu,
  openWorkspaceSettings,
  renameActiveDiagram,
  replaceSource,
  selectTabByName,
  selectWorkspaceTheme,
  templateMenuItem,
  visitWorkspace,
  waitForCanvas,
  waitForInvalidPreview,
  waitForSource,
  waitForSyncedSource,
} from './e2e/support/workspace.ts';

const SETTINGS_TRIGGER_TEST_ID = 'workspace-settings-trigger';
const SETTINGS_DIALOG_TEST_ID = 'workspace-settings-dialog';

const ANCHORS = {
  canvas: '[data-testid="canvas-first-workspace"]',
  footer: '[data-testid="workspace-footer"]',
  tabBar: '[data-testid="diagram-tab-bar"]',
  topbar: '.workspace-topbar',
};

const SOURCE_OWNED_COLOR_FIXTURE = `flowchart LR
  classDef critical fill:#ffec99,stroke:#d9480f,color:#4a2c00;
  Browser[Browser]:::critical --> Gateway[Gateway]
  Gateway --> Service[Service]`;

const TRANSPARENT_MERMAID_FIXTURE = `flowchart LR
  classDef ghost fill:none,stroke:transparent,color:transparent;
  Ghost[Ghost]:::ghost --> Visible[Visible]`;

const CONNECT_SOURCE_SAFE_FIXTURE = `flowchart LR
  Source["Session A (Worker 1)"]:::worker
  Target["Session B (Worker 2)"]
  classDef worker fill:#e7f5ff,stroke:#1864ab,color:#0b2e59;
  class Source worker`;

const SHAPE_HANDLE_FIXTURE = `flowchart LR
  classDef cylinder fill:#e7f5ff,stroke:#1864ab,color:#0b2e59;
  Start[Start] --> Diamond{Diamond shape}
  Diamond --> Hexagon{{Hexagon shape}}
  Hexagon --> Cylinder[(A cylinder node with a deliberately much longer label)]:::cylinder`;

const HISTORY_PREVIOUS_FLOWCHART = `flowchart LR
  Browser[Browser] --> Prior[Prior revision]
  Prior --> API[API]`;
const HISTORY_CURRENT_FLOWCHART = `flowchart LR
  Browser[Browser] --> Current[Current revision]
  Current --> API[API]`;
const HISTORY_GENERIC_SEQUENCE = `sequenceDiagram
  Browser->>API: Historical request
  API-->>Browser: Historical response`;
const HISTORY_INVALID_FLOWCHART = 'this is a temporary invalid Mermaid revision';
const HISTORY_NEGATIVE_OBSERVATION_MS = 250;

const CLASS_DIAGRAM_FIXTURE = `classDiagram
  class Account
  class Order
  Account --> Order : places`;
const STATE_DIAGRAM_FIXTURE = `stateDiagram-v2
  [*] --> Draft
  Draft --> Published : publish
  Published --> [*]`;
const REQUIREMENT_DIAGRAM_FIXTURE = `requirementDiagram
  requirement order {
    id: 1
    text: "order is accepted"
    risk: low
    verifyMethod: test
  }
  element checkout {
    type: service
  }
  order - satisfies -> checkout`;

const ACTIVITY_FIT_VIEWPORT = { width: 1487, height: 1058 } as const;
const SAFE_FLYOUT_MARGIN = 16;

type AgentPresence = { destroy: () => void };

type ComputedNodeColors = {
  background: string;
  border: string;
  text: string;
};

function record(results: string[], name: string): void {
  results.push(name);
  console.log(`PASS ${name}`);
}

async function readNodeColors(node: Locator): Promise<ComputedNodeColors> {
  return node.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderTopColor, text: style.color };
  });
}

async function waitForNodeColors(
  node: Locator,
  expected: ComputedNodeColors,
  label: string,
): Promise<ComputedNodeColors> {
  let settled: ComputedNodeColors | null = null;
  await expect.poll(async () => {
    if (await node.count() === 0) return null;
    settled = await readNodeColors(node);
    return settled;
  }, {
    message: `${label} did not settle to the source-owned Mermaid colors.`,
    timeout: 15_000,
  }).toEqual(expected);
  assert(settled !== null, `${label} did not render a Mermaid node.`);
  return settled;
}

async function waitForFlowchartFixtureRender(page: Page): Promise<void> {
  await page.locator('.mermaid-flow-node').filter({ hasText: 'Database' }).first()
    .waitFor({ state: 'visible', timeout: 15_000 });
}

async function expectUnclippedShapeHandles(page: Page): Promise<void> {
  await replaceSource(page, SHAPE_HANDLE_FIXTURE);
  await waitForSource(page, SHAPE_HANDLE_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await triggerCanvasFit(page, 'shape handle fit diagram');
  await waitForStableCanvasTransform(page, 'shape handle fit diagram');

  for (const label of ['Diamond shape', 'Hexagon shape', 'A cylinder node with a deliberately much longer label']) {
    const node = page.locator('.mermaid-flow-node').filter({ hasText: label }).first();
    await node.waitFor({ state: 'visible', timeout: 15_000 });
    await node.hover();
    const geometry = await node.evaluate((element) => {
      const surface = element.querySelector<HTMLElement>('.mermaid-flow-node-surface');
      if (!surface) return null;
      const surfaceRect = surface.getBoundingClientRect();
      const nodeRect = element.getBoundingClientRect();
      const handles: Record<string, {
        extendsPastSurface: boolean;
        hitClassName: string | null;
        outerEdgeHit: boolean;
        visible: boolean;
      } | null> = {};
      for (const position of ['left', 'right', 'top', 'bottom']) {
        const handle = element.querySelector<HTMLElement>(`.mermaid-flow-handle--${position}.mermaid-flow-handle--source`);
        if (!handle) {
          handles[position] = null;
          continue;
        }
        const rect = handle.getBoundingClientRect();
        const x = position === 'left' ? rect.left + 1 : position === 'right' ? rect.right - 1 : rect.left + (rect.width / 2);
        const y = position === 'top' ? rect.top + 1 : position === 'bottom' ? rect.bottom - 1 : rect.top + (rect.height / 2);
        const hit = document.elementFromPoint(x, y);
        handles[position] = {
          extendsPastSurface: position === 'left' ? rect.left < surfaceRect.left
            : position === 'right' ? rect.right > surfaceRect.right
              : position === 'top' ? rect.top < surfaceRect.top
              : rect.bottom > surfaceRect.bottom,
          hitClassName: hit instanceof HTMLElement ? hit.className : null,
          outerEdgeHit: hit === handle || hit?.closest('.mermaid-flow-handle') === handle,
          visible: getComputedStyle(handle).opacity !== '0',
        };
      }
      const cylinder = surface.classList.contains('mermaid-flow-node-surface--cylinder');
      const before = getComputedStyle(surface, '::before');
      const surfaceStyle = getComputedStyle(surface);
      return {
        cylinder,
        handles,
        nodeMatchesSurface: Math.abs(nodeRect.width - surfaceRect.width) < 0.5 && Math.abs(nodeRect.height - surfaceRect.height) < 0.5,
        cylinderRimMatchesSurface: !cylinder || (
          before.left === '-1px'
          && before.right === '-1px'
          && Math.abs(parseFloat(before.width) - surface.offsetWidth) <= 2
        ),
        cylinderRimLeft: before.left,
        cylinderRimRight: before.right,
        cylinderRimStrokeMatchesSurface: !cylinder || before.borderTopColor === surfaceStyle.borderTopColor,
        cylinderRimWidth: before.width,
        surfaceLayoutWidth: surface.offsetWidth,
        surfaceWidth: surfaceRect.width,
        wrapperClipPath: getComputedStyle(element).clipPath,
      };
    });
    assert(geometry !== null, `${label} did not render a shape surface.`);
    assert(geometry.nodeMatchesSurface, `${label} shape surface changed the measured React Flow node geometry: ${JSON.stringify(geometry)}.`);
    assert(geometry.wrapperClipPath === 'none', `${label} React Flow node wrapper still clips its handles: ${JSON.stringify(geometry)}.`);
    for (const position of ['left', 'right', 'top', 'bottom']) {
      const handle = geometry.handles[position];
      assert(handle?.visible && handle.extendsPastSurface && handle.outerEdgeHit,
        `${label} ${position} handle was clipped or lost its outer hit target: ${JSON.stringify(geometry)}.`);
    }
    if (geometry.cylinder) {
      assert(geometry.surfaceWidth > 200 && geometry.cylinderRimMatchesSurface && geometry.cylinderRimStrokeMatchesSurface,
        `Large-label cylinder decoration no longer tracks the painted surface width: ${JSON.stringify(geometry)}.`);
    }
  }
  await saveScreenshot(page, 'shape-handle-surfaces');

  const diamond = page.locator('.mermaid-flow-node').filter({ hasText: 'Diamond shape' }).first();
  const start = page.locator('.mermaid-flow-node').filter({ hasText: 'Start' }).first();
  const sourceHandle = diamond.locator('.mermaid-flow-handle--left.mermaid-flow-handle--source');
  const targetHandle = start.locator('.mermaid-flow-handle--right.mermaid-flow-handle--target');
  const [sourceBox, targetBox] = await Promise.all([sourceHandle.boundingBox(), targetHandle.boundingBox()]);
  assert(sourceBox && targetBox, 'Shape fixture did not expose a source and target handle for connection validation.');
  await page.mouse.move(sourceBox.x + (sourceBox.width / 2), sourceBox.y + (sourceBox.height / 2));
  await page.mouse.down();
  await page.mouse.move(targetBox.x + (targetBox.width / 2), targetBox.y + (targetBox.height / 2), { steps: 12 });
  await page.waitForFunction(() => {
    const target = document.querySelector('.mermaid-flow-node .mermaid-flow-handle--right.mermaid-flow-handle--target');
    return target?.classList.contains('connectionindicator') ?? false;
  }, undefined, { timeout: 5_000 });
  await page.mouse.up();
  const edgeLabel = page.getByPlaceholder('label (optional)', { exact: true });
  await edgeLabel.waitFor({ state: 'visible', timeout: 5_000 });
  await edgeLabel.press('Enter');
  await page.waitForFunction(() => !document.querySelector('input[placeholder="label (optional)"]'), undefined, { timeout: 5_000 });
}

async function waitForFocusedTestId(page: Page, testId: string, label: string): Promise<void> {
  try {
    await page.waitForFunction((expectedTestId) => document.activeElement?.getAttribute('data-testid') === expectedTestId, testId, { timeout: 5_000 });
  } catch {
    const active = await page.evaluate(() => ({
      ariaLabel: document.activeElement?.getAttribute('aria-label'),
      role: document.activeElement?.getAttribute('role'),
      tag: document.activeElement?.tagName,
      testId: document.activeElement?.getAttribute('data-testid'),
      text: document.activeElement?.textContent?.trim().slice(0, 80),
    }));
    throw new Error(`${label} did not restore focus to [data-testid=${JSON.stringify(testId)}]; active=${JSON.stringify(active)}.`);
  }
}

async function waitForFocusedLocator(page: Page, target: Locator, label: string): Promise<void> {
  try {
    await target.waitFor({ state: 'visible', timeout: 5_000 });
    const element = await target.elementHandle();
    assert(element, `${label} has no focusable element.`);
    await page.waitForFunction((candidate) => document.activeElement === candidate, element, { timeout: 5_000 });
  } catch {
    const active = await page.evaluate(() => ({
      ariaLabel: document.activeElement?.getAttribute('aria-label'),
      role: document.activeElement?.getAttribute('role'),
      text: document.activeElement?.textContent?.trim().slice(0, 80),
    }));
    throw new Error(`${label} did not receive focus: active=${JSON.stringify(active)}.`);
  }
}

async function canvasTransform(page: Page): Promise<string | null> {
  const layer = page.locator('.diagram-canvas-svg').locator('..');
  if (await layer.count() === 0) return null;
  return layer.getAttribute('style');
}

async function assertTemplateIdentityAbsent(page: Page): Promise<void> {
  const renderedDocument = await page.locator('html').innerHTML();
  for (const { id } of STARTER_TEMPLATES) {
    assert(!renderedDocument.includes(id), `Creation-time template identity leaked into rendered document markup: ${id}.`);
  }
}

async function renderedCanvasTransform(page: Page, label: string): Promise<string> {
  const transform = await canvasTransform(page);
  assert(transform !== null, `${label} requires a rendered canvas camera layer.`);
  return transform;
}

async function renderedCanvasCameraTransform(page: Page, label: string): Promise<string> {
  const layer = page.locator('.diagram-canvas-svg').locator('..');
  const transform = await layer.evaluate((element) => (element as HTMLElement).style.transform);
  assert(transform.length > 0, `${label} requires a rendered canvas transform.`);
  return transform;
}

async function canvasDotGridStyle(page: Page, label: string): Promise<{
  backgroundPosition: string;
  backgroundSize: string;
  dotRadius: string;
  transitionDuration: string;
  transitionProperty: string;
  transitionTimingFunction: string;
}> {
  const grid = page.getByTestId('canvas-dot-grid');
  await grid.waitFor({ state: 'visible', timeout: 5_000 });
  const style = await grid.evaluate((element) => {
    const gridStyle = (element as HTMLElement).style;
    return {
      backgroundPosition: gridStyle.backgroundPosition,
      backgroundSize: gridStyle.backgroundSize,
      dotRadius: gridStyle.getPropertyValue('--canvas-grid-dot-radius'),
      transitionDuration: gridStyle.transitionDuration,
      transitionProperty: gridStyle.transitionProperty,
      transitionTimingFunction: gridStyle.transitionTimingFunction,
    };
  });
  assert(style.backgroundPosition && style.backgroundSize && style.dotRadius,
    `${label} dot grid did not expose its camera-derived visual style.`);
  return style;
}

async function assertDotGridTracksCamera(page: Page, label: string): Promise<{
  backgroundPosition: string;
  backgroundSize: string;
  dotRadius: string;
  transitionDuration: string;
  transitionProperty: string;
  transitionTimingFunction: string;
}> {
  const camera = parseCameraTransform(await renderedCanvasCameraTransform(page, `${label} camera`), `${label} camera`);
  const actual = await canvasDotGridStyle(page, label);
  const expected = getCanvasDotGridGeometry(camera);
  assert(Math.abs(Number.parseFloat(actual.dotRadius) - Number.parseFloat(expected.dotRadius)) < 0.01,
    `${label} dot grid radius diverged from the shared camera zoom: ${JSON.stringify({ actual, camera, expected })}.`);
  for (const property of ['backgroundPosition', 'backgroundSize'] as const) {
    const actualValues = actual[property].split(' ').map((value) => Number.parseFloat(value));
    const expectedValues = expected[property].split(' ').map((value) => Number.parseFloat(value));
    assert(
      actualValues.length === 2
        && expectedValues.length === 2
        && actualValues.every((value, index) => Math.abs(value - expectedValues[index]!) < 0.01),
      `${label} dot grid ${property} diverged from the shared camera: ${JSON.stringify({ actual, camera, expected })}.`,
    );
  }
  return actual;
}

async function assertDotGridTransition(page: Page, expected: boolean, label: string): Promise<void> {
  const grid = page.getByTestId('canvas-dot-grid');
  await expect.poll(async () => grid.evaluate((element) => {
    const style = (element as HTMLElement).style;
    return {
      duration: style.transitionDuration,
      property: style.transitionProperty,
      timingFunction: style.transitionTimingFunction,
    };
  }), {
    message: `${label} did not settle the expected dot-grid transition contract.`,
    timeout: 5_000,
  }).toEqual(expected
    ? {
      duration: '180ms, 180ms, 180ms',
      property: 'background-position, background-size, --canvas-grid-dot-radius',
      timingFunction: 'ease, ease, ease',
    }
    : { duration: '', property: '', timingFunction: '' });
}

async function triggerCanvasFit(page: Page, label: string): Promise<void> {
  await verifiedClick(page, page.getByRole('button', { name: 'Fit diagram', exact: true }), label);
}

async function expectCanvasCameraControlHitTargets(page: Page, label: string): Promise<void> {
  const controls = page.getByTestId('canvas-controls-toolbar');
  await controls.waitFor({ state: 'visible', timeout: 15_000 });
  for (const actionName of ['Zoom out', 'Zoom in'] as const) {
    const before = await renderedCanvasCameraTransform(page, `${label} ${actionName} baseline`);
    await verifiedClick(page, controls.getByRole('button', { name: actionName, exact: true }), `${label} ${actionName}`);
    await page.waitForFunction((previous) => {
      const layer = document.querySelector('.diagram-canvas-svg')?.parentElement;
      return layer instanceof HTMLElement && layer.style.transform !== previous;
    }, before, { timeout: 5_000 });
  }
  await verifiedClick(page, controls.getByRole('button', { name: 'Fit diagram', exact: true }), `${label} Fit diagram`);
}

async function waitForStableCanvasTransform(page: Page, label: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  let samples: string[] = [];
  while (Date.now() < deadline) {
    samples = await page.evaluate(async () => {
      const layer = document.querySelector('.diagram-canvas-svg')?.parentElement;
      if (!(layer instanceof HTMLElement)) {
        return [];
      }
      const transforms: string[] = [];
      for (let frame = 0; frame < 4; frame += 1) {
        await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve(); }); });
        transforms.push(layer.style.transform);
      }
      return transforms;
    });
    if (samples.length === 4 && samples[0] && samples.every((transform) => transform === samples[0])) {
      return samples[0];
    }
  }
  throw new Error(`${label} did not settle a rendered canvas camera transform: ${JSON.stringify(samples)}.`);
}

type CanvasCameraSnapshot = {
  panX: number;
  panY: number;
  zoom: number;
};

async function readCanvasCameraSnapshot(page: Page, label: string): Promise<CanvasCameraSnapshot> {
  return page.evaluate((currentLabel) => {
    const layer = document.querySelector('.diagram-canvas-svg')?.parentElement;
    if (!(layer instanceof HTMLElement)) {
      throw new Error(`${currentLabel} could not find the rendered canvas camera layer.`);
    }
    const match = /^translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)$/u.exec(layer.style.transform);
    if (!match) {
      throw new Error(`${currentLabel} found an unexpected canvas transform: ${JSON.stringify(layer.style.transform)}.`);
    }
    return { panX: Number(match[1]), panY: Number(match[2]), zoom: Number(match[3]) };
  }, label);
}

async function dispatchTrustedCanvasWheel(
  page: Page,
  label: string,
  renderer: 'flowchart' | 'generic',
  options: { ctrlKey: boolean; deltaX: number; deltaY: number },
): Promise<{
  browserScale: number;
  defaultPrevented: boolean;
  devicePixelRatio: number;
  isTrusted: boolean;
  point: CanvasGesturePoint;
}> {
  const [point] = await allowedCanvasGesturePoints(page, `${label} trusted wheel`, 1, 0);
  assert(point, `${label} did not find a blank canvas point for trusted wheel input.`);
  const pointOwnership = await page.evaluate((clientPoint) => {
    const target = document.elementFromPoint(clientPoint.x, clientPoint.y);
    return {
      inReactFlowPane: target instanceof Element && target.closest('.react-flow__pane') !== null,
      target: target instanceof Element ? target.className : null,
    };
  }, point);
  assert(
    renderer === 'flowchart' ? pointOwnership.inReactFlowPane : !pointOwnership.inReactFlowPane,
    `${label} trusted wheel missed the expected ${renderer} blank canvas surface: ${JSON.stringify(pointOwnership)}.`,
  );
  await page.evaluate(() => {
    document.addEventListener('wheel', (event) => {
      document.body.dataset.canvasWheelResult = JSON.stringify({
        defaultPrevented: event.defaultPrevented,
        isTrusted: event.isTrusted,
      });
    }, { once: true });
  });
  await page.mouse.move(point.x, point.y);
  if (options.ctrlKey) await page.keyboard.down('Control');
  try {
    await page.mouse.wheel(options.deltaX, options.deltaY);
  } finally {
    if (options.ctrlKey) await page.keyboard.up('Control');
  }
  await page.waitForFunction(() => document.body.dataset.canvasWheelResult !== undefined, undefined, { timeout: 5_000 });
  return page.evaluate((clientPoint) => {
    const result = JSON.parse(document.body.dataset.canvasWheelResult ?? '{}') as {
      defaultPrevented?: boolean;
      isTrusted?: boolean;
    };
    delete document.body.dataset.canvasWheelResult;
    return {
      browserScale: window.visualViewport?.scale ?? 1,
      defaultPrevented: result.defaultPrevented === true,
      devicePixelRatio: window.devicePixelRatio,
      isTrusted: result.isTrusted === true,
      point: clientPoint,
    };
  }, point);
}

async function expectWheelGestureCameraControls(page: Page, label: string, renderer: 'flowchart' | 'generic'): Promise<void> {
  const canvas = page.getByTestId('diagram-canvas');
  await canvas.waitFor({ state: 'visible', timeout: 15_000 });
  await verifiedClick(page, page.getByRole('button', { name: 'Zoom out', exact: true }), `${label} wheel headroom`);
  await waitForStableCanvasTransform(page, `${label} wheel headroom`);
  const beforePan = await readCanvasCameraSnapshot(page, `${label} wheel-pan baseline`);
  const normalWheel = await dispatchTrustedCanvasWheel(page, label, renderer, { ctrlKey: false, deltaX: 18, deltaY: 32 });
  const afterPan = await readCanvasCameraSnapshot(page, `${label} wheel-pan result`);
  assert(normalWheel.isTrusted && normalWheel.defaultPrevented, `${label} normal trusted wheel was not owned by the canvas.`);
  assert(afterPan.zoom === beforePan.zoom && (afterPan.panX !== beforePan.panX || afterPan.panY !== beforePan.panY),
    `${label} ordinary two-finger scroll did not pan without zooming: ${JSON.stringify({ beforePan, afterPan })}.`);

  const beforeZoom = afterPan;
  const browserBeforeZoom = await page.evaluate(() => ({
    browserScale: window.visualViewport?.scale ?? 1,
    devicePixelRatio: window.devicePixelRatio,
  }));
  const pinch = await dispatchTrustedCanvasWheel(page, label, renderer, { ctrlKey: true, deltaX: 0, deltaY: -20 });
  await expect.poll(async () => (await readCanvasCameraSnapshot(page, `${label} ctrl-wheel settle`)).zoom, {
    message: `${label} ctrl-wheel zoom did not settle after trusted input.`,
    timeout: 5_000,
  }).not.toBe(beforeZoom.zoom);
  const afterZoom = await readCanvasCameraSnapshot(page, `${label} ctrl-wheel result`);
  const canvasBounds = await canvas.boundingBox();
  assert(canvasBounds, `${label} lost its canvas bounds during ctrl-wheel zoom.`);
  const anchoredCanvasPoint = {
    x: (pinch.point.x - canvasBounds.x - beforeZoom.panX) / beforeZoom.zoom,
    y: (pinch.point.y - canvasBounds.y - beforeZoom.panY) / beforeZoom.zoom,
  };
  const anchoredScreenPoint = {
    x: afterZoom.panX + (anchoredCanvasPoint.x * afterZoom.zoom),
    y: afterZoom.panY + (anchoredCanvasPoint.y * afterZoom.zoom),
  };
  assert(pinch.isTrusted && pinch.defaultPrevented, `${label} trusted ctrl-wheel pinch was not cancelled before browser zoom.`);
  assert(afterZoom.zoom > beforeZoom.zoom && afterZoom.zoom < beforeZoom.zoom * 1.1,
    `${label} ctrl-wheel zoom was missing or too sensitive: ${JSON.stringify({ beforeZoom, afterZoom })}.`);
  assert(pinch.browserScale === 1 && browserBeforeZoom.browserScale === 1
    && pinch.devicePixelRatio === browserBeforeZoom.devicePixelRatio,
  `${label} ctrl-wheel changed the browser viewport scale: ${JSON.stringify({ browserBeforeZoom, pinch })}.`);
  assert(Math.abs(anchoredScreenPoint.x - (pinch.point.x - canvasBounds.x)) < 0.1
    && Math.abs(anchoredScreenPoint.y - (pinch.point.y - canvasBounds.y)) < 0.1,
  `${label} ctrl-wheel zoom did not keep its blank-pane cursor point anchored: ${JSON.stringify({ afterZoom, anchoredScreenPoint, pinch })}.`);
}

async function expectBlankCanvasClickClearsSelection(page: Page): Promise<void> {
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  const node = page.locator('.mermaid-flow-node').first();
  await verifiedClick(page, node, 'select flowchart node before blank canvas click');
  await expect.poll(() => canonicalSelectedNodeIds(page), { timeout: 5_000 }).not.toEqual([]);
  const [flowchartBlankPoint] = await allowedCanvasGesturePoints(page, 'flowchart blank selection clear', 1, 0);
  assert(flowchartBlankPoint, 'Flowchart selection clear did not find a blank canvas point.');
  await page.mouse.click(flowchartBlankPoint.x, flowchartBlankPoint.y);
  await expect.poll(() => canonicalSelectedNodeIds(page), { timeout: 5_000 }).toEqual([]);
  assert((await renderedSelectedNodeIds(page)).length === 0, 'Blank flowchart canvas click left a React Flow node selected.');
  const flowchartVisualState = await node.evaluate((element) => {
    const surface = element.querySelector<HTMLElement>('.mermaid-flow-node-surface');
    return {
      focusVisible: element.matches(':focus-visible'),
      outline: surface ? getComputedStyle(surface).outlineStyle : null,
    };
  });
  assert(!flowchartVisualState.focusVisible && flowchartVisualState.outline === 'none',
    `Blank flowchart click left a focus-ring-like node treatment: ${JSON.stringify(flowchartVisualState)}.`);

  await replaceSource(page, API_SEQUENCE_FIXTURE);
  await waitForCanvas(page, 'sequence');
  const [genericBlankPoint] = await allowedCanvasGesturePoints(page, 'generic Mermaid blank-canvas smoke', 1, 0);
  assert(genericBlankPoint, 'Generic Mermaid blank-canvas smoke did not find a blank canvas point.');
  await page.mouse.click(genericBlankPoint.x, genericBlankPoint.y);
  assert(await page.getByTestId('diagram-canvas').isVisible(), 'Generic Mermaid blank-canvas click did not retain its canvas surface.');
}

async function closeWorkspaceSettings(page: Page): Promise<void> {
  const dialog = page.getByTestId(SETTINGS_DIALOG_TEST_ID);
  const closeButton = dialog.getByRole('button', { name: 'Close', exact: true });
  await verifiedClick(page, closeButton, 'workspace settings Close');
  await dialog.waitFor({ state: 'detached', timeout: 15_000 });
  const trigger = page.getByTestId(SETTINGS_TRIGGER_TEST_ID);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false', { timeout: 5_000 });
  await waitForFocusedLocator(page, trigger, 'Closing workspace settings');
}

async function beginWorkspaceSettingsTransitionTrace(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    const trace = [];
    const readTarget = (element) => element instanceof Element
      ? element.getAttribute('data-testid') || element.id || element.getAttribute('value') || element.tagName.toLowerCase()
      : null;
    const snapshot = (label, event) => {
      if (trace.length >= 32) return;
      trace.push({
        active: readTarget(document.activeElement),
        defaultPrevented: event?.defaultPrevented ?? null,
        dialogCount: document.querySelectorAll('[data-testid="workspace-settings-dialog"]').length,
        event: event?.type ?? null,
        expanded: document.querySelector('[data-testid="workspace-settings-trigger"]')?.getAttribute('aria-expanded') ?? null,
        key: event instanceof KeyboardEvent ? event.key : null,
        label,
        overlays: document.querySelectorAll('.modal-backdrop, [role="dialog"]:not(#workspace-settings-dialog)').length,
        target: readTarget(event?.target ?? null),
      });
    };
    const listener = (event) => snapshot('event', event);
    const eventTypes = ['keydown', 'keyup', 'pointerdown', 'pointerup', 'click'];
    for (const type of eventTypes) document.addEventListener(type, listener, true);
    const observer = new MutationObserver(() => snapshot('mutation', null));
    const trigger = document.querySelector('[data-testid="workspace-settings-trigger"]');
    if (trigger) observer.observe(trigger, { attributeFilter: ['aria-expanded'], attributes: true });
    observer.observe(document.body, { childList: true, subtree: true });
    snapshot('start', null);
    window.__workspaceSettingsTransitionTrace = { eventTypes, listener, observer, trace };
  })()`);
}

async function finishWorkspaceSettingsTransitionTrace(page: Page): Promise<unknown> {
  return page.evaluate(`(() => {
    const state = window.__workspaceSettingsTransitionTrace;
    if (!state) return [];
    state.observer.disconnect();
    for (const type of state.eventTypes) document.removeEventListener(type, state.listener, true);
    const trace = state.trace;
    delete window.__workspaceSettingsTransitionTrace;
    return trace;
  })()`);
}

async function closeThemeSettingsWithEscape(
  page: Page,
  preference: 'system' | 'light' | 'dark',
): Promise<void> {
  const dialog = page.getByTestId(SETTINGS_DIALOG_TEST_ID);
  const label = preference[0]?.toUpperCase() + preference.slice(1);
  const radio = dialog.getByRole('radio', { name: new RegExp(`^${label}(?:\\s|$)`, 'u') });
  await beginWorkspaceSettingsTransitionTrace(page);
  try {
    await radio.press('Escape');
    await dialog.waitFor({ state: 'detached', timeout: 15_000 });
    const trigger = page.getByTestId(SETTINGS_TRIGGER_TEST_ID);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false', { timeout: 5_000 });
    await waitForFocusedLocator(page, trigger, `Closing ${preference} theme settings with Escape`);
  } catch (error) {
    const trace = await finishWorkspaceSettingsTransitionTrace(page);
    throw new Error(`Theme settings Escape did not complete: ${JSON.stringify(trace)}`, { cause: error });
  }
  const trace = await finishWorkspaceSettingsTransitionTrace(page);
  if (process.env.ARIELCHARTS_E2E_TRACE_SETTINGS_CLOSE === '1') {
    console.log(`THEME SETTINGS CLOSE TRACE ${JSON.stringify(trace)}`);
  }
}

async function selectThemePreference(page: Page, preference: 'system' | 'light' | 'dark'): Promise<void> {
  await selectWorkspaceTheme(page, preference);
  const resolvedTheme = preference === 'system'
    ? await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : preference;
  await page.locator(
    `[data-testid="${SETTINGS_TRIGGER_TEST_ID}"][data-theme-preference="${preference}"][data-resolved-theme="${resolvedTheme}"]`,
  ).waitFor({ state: 'attached', timeout: 5_000 });
  await page.locator(`html[data-theme="${resolvedTheme}"]`).waitFor({ state: 'attached', timeout: 5_000 });
  await closeThemeSettingsWithEscape(page, preference);
}

async function connectAgentPresence(mcpUrl: string, sessionId: string, roomCookie: string, origin: string): Promise<AgentPresence> {
  const endpoint = getWebsocketServerUrl(new URL(mcpUrl).origin);
  const doc = new Y.Doc();
  const WebSocketPolyfill = class CookieWebSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols, { headers: { cookie: roomCookie, origin } });
    }
  };
  const provider = new WebsocketProvider(endpoint, sessionId, doc, {
    maxBackoffTime: 2_500,
    resyncInterval: 10_000,
    WebSocketPolyfill: WebSocketPolyfill as unknown as typeof globalThis.WebSocket,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        provider.off('status', handleStatus);
        reject(new Error(`Agent awareness provider did not connect to ${endpoint} within 5 seconds.`));
      }, 5_000);
      const handleStatus = ({ status }: { status: 'connected' | 'connecting' | 'disconnected' }) => {
        if (status !== 'connected') {
          return;
        }
        clearTimeout(timeout);
        provider.off('status', handleStatus);
        resolve();
      };
      provider.on('status', handleStatus);
    });
  } catch (error) {
    provider.destroy();
    doc.destroy();
    throw error;
  }
  provider.awareness.setLocalState({
    user: { color: '#111111', name: 'E2E agent', type: 'agent' },
  });
  return {
    destroy: () => {
      provider.destroy();
      doc.destroy();
    },
  };
}

async function expectTemplateMenu(page: Page): Promise<string> {
  const trigger = page.getByTestId('create-diagram-tab');
  await assertHitTarget(page, trigger, 'always-visible template creation control');
  const before = await snapshotAnchors(page, ANCHORS);
  const beforeTransform = await canvasTransform(page);
  const menu = await openTemplateMenu(page);
  await assertDocumentHasNoHorizontalOverflow(page);
  await assertContainedInViewport(page, menu, 'desktop starter template menu');
  const blank = templateMenuItem(page, 'Blank sheet');
  const apiSequence = templateMenuItem(page, 'End-to-end API sequence');
  const deployment = templateMenuItem(page, 'Deployment architecture');
  const labels = (await menu.getByRole('menuitem').allTextContents()).map((value) => value.trim());
  assert(labels[0]?.startsWith('Blank sheet'), `Blank sheet is not first in the template menu: ${JSON.stringify(labels)}.`);
  await waitForFocusedLocator(page, blank, 'Opening template menu');
  const tabStops = await menu.getByRole('menuitem').evaluateAll((items) => items.map((item) => ({
    tabIndex: (item as HTMLElement).tabIndex,
    text: item.textContent?.trim() ?? '',
  })).filter((item) => item.tabIndex === 0));
  assert(tabStops.length === 1 && tabStops[0]?.text.startsWith('Blank sheet'),
    `Template menu must begin with only Blank sheet in the tab order: ${JSON.stringify(tabStops)}.`);
  await saveScreenshot(page, 'issue-28-light-flat-template-menu');
  await blank.press('Tab');
  await menu.waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, 'source-flyout-toggle', 'Tabbing forward out of the template menu');

  await openTemplateMenu(page);
  await waitForFocusedLocator(page, blank, 'Reopening template menu after Tab exit');
  await blank.press('ArrowDown');
  await waitForFocusedLocator(page, apiSequence, 'ArrowDown in template menu');
  await apiSequence.press('ArrowUp');
  await waitForFocusedLocator(page, blank, 'ArrowUp in template menu');
  await blank.press('ArrowDown');
  await waitForFocusedLocator(page, apiSequence, 'ArrowDown adjacency check in template menu');
  await apiSequence.press('Home');
  await waitForFocusedLocator(page, blank, 'Home in template menu');
  await blank.press('End');
  await waitForFocusedLocator(page, deployment, 'End in template menu');
  await deployment.press('Escape');
  await menu.waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, 'create-diagram-tab', 'Closing template menu with Escape');
  assertAnchorsStable(before, await snapshotAnchors(page, ANCHORS));
  assert(await canvasTransform(page) === beforeTransform, 'Opening and closing the template menu changed the canvas camera.');

  await selectThemePreference(page, 'dark');
  await openTemplateMenu(page);
  await saveScreenshot(page, 'issue-28-dark-flat-template-menu');
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached', timeout: 15_000 });
  await selectThemePreference(page, 'light');

  const outsideBefore = await snapshotAnchors(page, ANCHORS);
  const outsideBeforeTransform = await canvasTransform(page);
  await openTemplateMenu(page);
  await page.locator('.workspace-logo').click();
  await menu.waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, 'create-diagram-tab', 'Closing template menu from nonfocusable page chrome');
  assertAnchorsStable(outsideBefore, await snapshotAnchors(page, ANCHORS));
  assert(await canvasTransform(page) === outsideBeforeTransform, 'Outside-closing the template menu changed the canvas camera.');

  await openTemplateMenu(page);
  const sourceToggle = page.getByTestId('source-flyout-toggle');
  await sourceToggle.click();
  await menu.waitFor({ state: 'detached', timeout: 15_000 });
  await page.getByTestId('source-flyout').waitFor({ state: 'visible', timeout: 15_000 });
  await waitForFocusedLocator(page, page.locator('.cm-content'), 'Clicking an interactive control outside the template menu');
  assert(await trigger.evaluate((element) => document.activeElement !== element),
    'Clicking an interactive control outside the template menu had its focus stolen by the creation trigger.');
  await closeFlyout(page, 'source');

  const blankName = await createDiagramFromTemplate(page, 'Blank sheet');
  await waitForFocusedLocator(page, page.getByRole('tab', { name: blankName, exact: true }), 'Creating a template diagram');
  await ensureSourceFlyoutOpen(page);
  assert(await canonicalSource(page) === '', 'Blank starter template did not create empty Mermaid source.');
  await closeFlyout(page, 'source');
  return blankName;
}

async function expectTemplateDiagramCreation(page: Page): Promise<void> {
  const flowchartName = await createDiagramFromTemplate(page, 'Service / system flowchart');
  await waitForCanvas(page, 'flowchart');
  assert(await page.locator('form[aria-label="Add Mermaid node"]').count() === 1,
    'Service flowchart template did not expose structural controls.');
  await renameActiveDiagram(page, 'Service API flow');
  await ensureSourceFlyoutOpen(page);
  const flowchartSource = await canonicalSource(page);
  await replaceSource(page, `${flowchartSource}\n  Service --> Audit[Audit log]`);
  await waitForSource(page, `${flowchartSource}\n  Service --> Audit[Audit log]`);
  await waitForCanvas(page, 'flowchart');
  await closeFlyout(page, 'source');
  await saveScreenshot(page, 'issue-15-service-flowchart');

  const sequenceName = await createDiagramFromTemplate(page, 'End-to-end API sequence');
  await waitForCanvas(page, 'sequence');
  assert(await page.locator('form[aria-label="Add Mermaid node"]').count() === 0,
    'API sequence template retained flowchart structural controls.');
  assert(await page.locator('form.canvas-sequence-participant-form').count() === 1,
    'API sequence template did not expose participant controls.');
  assert(await page.locator('form.canvas-sequence-message-form:has([aria-label="Sequence message"])').count() === 1,
    'API sequence template did not expose message controls.');
  await renameActiveDiagram(page, 'API request timing');
  await ensureSourceFlyoutOpen(page);
  const sequenceSource = await canonicalSource(page);
  await replaceSource(page, `${sequenceSource}\n  Note over Client,API: traced in live coding`);
  await waitForSource(page, `${sequenceSource}\n  Note over Client,API: traced in live coding`);
  await waitForCanvas(page, 'sequence');
  await closeFlyout(page, 'source');
  await saveScreenshot(page, 'issue-15-api-sequence');
  await assertTemplateIdentityAbsent(page);
  const headerOnlySequenceSource = 'sequenceDiagram';
  await ensureSourceFlyoutOpen(page);
  await replaceSource(page, headerOnlySequenceSource);
  await waitForSource(page, headerOnlySequenceSource);
  await waitForCanvas(page, 'sequence');
  await closeFlyout(page, 'source');
  const centeredSequenceEditor = page.getByTestId('sequence-editor-controls');
  await centeredSequenceEditor.waitFor({ state: 'visible', timeout: 15_000 });
  const centeredSequenceLayout = await centeredSequenceEditor.evaluate((editor) => {
    const canvas = editor.closest('[data-testid="diagram-canvas"]');
    if (!(canvas instanceof HTMLElement)) return null;
    const editorBounds = editor.getBoundingClientRect();
    const canvasBounds = canvas.getBoundingClientRect();
    return {
      bottom: editorBounds.bottom,
      left: editorBounds.left,
      right: editorBounds.right,
      top: editorBounds.top,
      withinCanvas: editorBounds.top >= canvasBounds.top - 0.5
        && editorBounds.bottom <= canvasBounds.bottom + 0.5
        && editorBounds.left >= canvasBounds.left - 0.5
        && editorBounds.right <= canvasBounds.right + 0.5,
    };
  });
  assert(centeredSequenceLayout?.withinCanvas,
    `Centered header-only sequence controls did not overlay the canvas: ${JSON.stringify(centeredSequenceLayout)}.`);
  await assertHitTarget(page, page.getByRole('button', { name: 'Add sequence participant', exact: true }), 'centered header-only sequence participant control');
  assert(flowchartName !== sequenceName, 'Flowchart and sequence templates reused the same created tab.');
}

async function scrollErControlIntoView(control: Locator): Promise<void> {
  await control.evaluate((element) => {
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
  });
}

async function expectErSemanticEditor(page: Page): Promise<void> {
  await replaceSource(page, ER_DIAGRAM_FIXTURE);
  await waitForSource(page, ER_DIAGRAM_FIXTURE);
  await waitForCanvas(page, 'er');
  await closeFlyout(page, 'source');
  const controls = page.getByTestId('er-editor-controls');
  const before = await snapshotAnchors(page, ANCHORS);
  const beforeTransform = await canvasTransform(page);

  const customerName = controls.getByLabel('ER entity CUSTOMER');
  await scrollErControlIntoView(customerName);
  await customerName.fill('ACCOUNT');
  const rename = customerName.locator('xpath=..').getByRole('button', { name: 'Rename', exact: true });
  await scrollErControlIntoView(rename);
  await assertHitTarget(page, rename, 'ER entity rename control');
  await verifiedClick(page, rename, 'ER entity rename control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('ACCOUNT ||--o{ ORDER : places');
  await closeFlyout(page, 'source');

  const attributeName = controls.getByLabel('New attribute for ACCOUNT');
  await scrollErControlIntoView(attributeName);
  await attributeName.fill('created_at');
  const addAttribute = attributeName.locator('xpath=..').getByRole('button', { name: 'Add attribute', exact: true });
  await assertHitTarget(page, addAttribute, 'ER add-attribute control');
  await verifiedClick(page, addAttribute, 'ER add-attribute control');
  const attributeForm = controls.getByRole('form', { name: 'Attribute created_at on ACCOUNT', exact: true });
  await scrollErControlIntoView(attributeForm);
  await attributeForm.getByLabel('Type for created_at').fill('timestamp');
  await attributeForm.getByLabel('Comment for created_at').fill('created');
  const saveAttribute = attributeForm.getByRole('button', { name: 'Save', exact: true });
  await scrollErControlIntoView(saveAttribute);
  await verifiedClick(page, saveAttribute, 'ER edit-attribute control');

  const existingRelationship = controls.getByRole('form', { name: 'Relationship ACCOUNT ORDER', exact: true }).first();
  await scrollErControlIntoView(existingRelationship);
  await existingRelationship.getByLabel('Relationship left entity').selectOption('ORDER');
  await existingRelationship.getByLabel('Relationship right entity').selectOption('ACCOUNT');
  await existingRelationship.getByLabel('Relationship label').fill('may place');
  await existingRelationship.getByLabel('Relationship left cardinality').selectOption('zero-or-one');
  await existingRelationship.getByLabel('Relationship right cardinality').selectOption('one-or-more');
  const saveRelationship = existingRelationship.getByRole('button', { name: 'Save', exact: true });
  await scrollErControlIntoView(saveRelationship);
  await verifiedClick(page, saveRelationship, 'ER edit-relationship control');
  const deleteRelationship = controls.getByRole('button', { name: 'Delete relationship may place', exact: true });
  await scrollErControlIntoView(deleteRelationship);
  await verifiedClick(page, deleteRelationship, 'ER delete-relationship control');
  const newRelationship = controls.getByRole('form', { name: 'Relationship ACCOUNT ORDER', exact: true }).last();
  await scrollErControlIntoView(newRelationship);
  await newRelationship.getByLabel('Relationship label').fill('places again');
  const addRelationship = newRelationship.getByRole('button', { name: 'Add relationship', exact: true });
  await scrollErControlIntoView(addRelationship);
  await verifiedClick(page, addRelationship, 'ER add-relationship control');

  const addEntity = controls.getByRole('button', { name: 'Add ER entity', exact: true });
  await scrollErControlIntoView(addEntity);
  await assertHitTarget(page, addEntity, 'ER add-entity control');
  await verifiedClick(page, addEntity, 'ER add-entity control');
  const deleteOrder = controls.getByRole('button', { name: 'Delete ORDER and dependent relationships', exact: true });
  await scrollErControlIntoView(deleteOrder);
  await verifiedClick(page, deleteOrder, 'ER delete-entity control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('ENTITY {');
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).not.toContain('ORDER {');
  await closeFlyout(page, 'source');
  assertAnchorsStable(before, await snapshotAnchors(page, ANCHORS));
  assert(await canvasTransform(page) === beforeTransform, 'ER form operations changed the generic Mermaid camera transform.');
  assert(await page.locator('.react-flow__node').count() === 0,
    'ER semantic form incorrectly exposed the generic React Flow editor.');

  const unsupported = 'erDiagram\n  ACCOUNT ||--o{ ORDER : places';
  await replaceSource(page, unsupported);
  await waitForSource(page, unsupported);
  await waitForCanvas(page, 'generic');
  const lastValidSvg = await page.locator('.diagram-canvas-svg svg').innerHTML();
  await replaceSource(page, 'erDiagram\n  ACCOUNT ||--o{');
  await waitForInvalidPreview(page);
  assert(await page.locator('.diagram-canvas-svg svg').innerHTML() === lastValidSvg,
    'Invalid ER source replaced the last valid SVG preview.');
}

async function expectRelationshipArchitectureEditors(page: Page): Promise<void> {
  const before = await snapshotAnchors(page, ANCHORS);
  const beforeTransform = await canvasTransform(page);

  await replaceSource(page, CLASS_DIAGRAM_FIXTURE);
  await waitForSource(page, CLASS_DIAGRAM_FIXTURE);
  await page.locator('.diagram-canvas-svg svg').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(300);
  await expect(page.getByTestId('diagram-mode')).toContainText('Class · editable · form');
  await page.getByTestId('class-editor-controls').waitFor({ state: 'visible', timeout: 15_000 });
  await closeFlyout(page, 'source');
  const classEditor = page.getByTestId('class-editor-controls');
  const addClass = classEditor.getByRole('button', { name: 'Add class', exact: true });
  await scrollErControlIntoView(addClass);
  await assertHitTarget(page, addClass, 'class add control');
  await verifiedClick(page, addClass, 'class add control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('class Class');
  await closeFlyout(page, 'source');
  await expect(page.getByTestId('diagram-mode')).toContainText('Class · editable · form');

  await replaceSource(page, STATE_DIAGRAM_FIXTURE);
  await waitForSource(page, STATE_DIAGRAM_FIXTURE);
  await page.locator('.diagram-canvas-svg svg').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(300);
  await expect(page.getByTestId('diagram-mode')).toContainText('State · editable · form');
  await page.getByTestId('state-editor-controls').waitFor({ state: 'visible', timeout: 15_000 });
  await closeFlyout(page, 'source');
  const stateEditor = page.getByTestId('state-editor-controls');
  const addState = stateEditor.getByRole('button', { name: 'Add state', exact: true });
  await scrollErControlIntoView(addState);
  await assertHitTarget(page, addState, 'state add control');
  await verifiedClick(page, addState, 'state add control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('state State');
  await closeFlyout(page, 'source');
  await expect(page.getByTestId('diagram-mode')).toContainText('State · editable · form');
  const nestedState = 'stateDiagram-v2\n  state Parent {\n    [*] --> Child\n  }';
  await replaceSource(page, nestedState);
  await waitForSource(page, nestedState);
  await expect(page.getByTestId('diagram-mode')).toContainText('State · source only');
  await expect(page.getByTestId('state-editor-controls')).toHaveCount(0);

  await replaceSource(page, REQUIREMENT_DIAGRAM_FIXTURE);
  await waitForSource(page, REQUIREMENT_DIAGRAM_FIXTURE);
  await page.locator('.diagram-canvas-svg svg').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(300);
  await expect(page.getByTestId('diagram-mode')).toContainText('Requirement · editable · form');
  await page.getByTestId('requirement-editor-controls').waitFor({ state: 'visible', timeout: 15_000 });
  await closeFlyout(page, 'source');
  const requirementEditor = page.getByTestId('requirement-editor-controls');
  const addRequirement = requirementEditor.getByRole('button', { name: 'Add requirement', exact: true });
  await scrollErControlIntoView(addRequirement);
  await assertHitTarget(page, addRequirement, 'requirement add control');
  await verifiedClick(page, addRequirement, 'requirement add control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('requirement req {');
  await closeFlyout(page, 'source');
  await expect(page.getByTestId('diagram-mode')).toContainText('Requirement · editable · form');
  assertAnchorsStable(before, await snapshotAnchors(page, ANCHORS));
  assert(await canvasTransform(page) === beforeTransform, 'Relationship/architecture semantic forms changed the generic Mermaid camera transform.');
}

async function expectStableFlyoutAnchors(page: Page, label: string): Promise<void> {
  const before = await snapshotAnchors(page, ANCHORS);
  await ensureFlyout(page, 'source');
  const afterOpen = await snapshotAnchors(page, ANCHORS);
  assertAnchorsStable(before, afterOpen);
  await closeFlyout(page, 'source');
  const afterClose = await snapshotAnchors(page, ANCHORS);
  assertAnchorsStable(before, afterClose);
  console.log(`anchors stable ±1px (${label})`);
}

async function expectSourceFlyoutResizeAndCodeOverflow(page: Page): Promise<void> {
  await ensureSourceFlyoutOpen(page);
  const flyout = page.getByTestId('source-flyout');
  const handle = page.getByTestId('source-flyout-resize-handle');
  await handle.waitFor({ state: 'visible', timeout: 15_000 });
  assert(await handle.getAttribute('role') === 'separator', 'Source flyout resize control is not an accessible separator.');
  assert(await handle.getAttribute('aria-orientation') === 'vertical', 'Source flyout resize control did not expose its vertical orientation.');

  const anchorsBeforeResize = await snapshotAnchors(page, ANCHORS);
  const cameraBeforeResize = await renderedCanvasCameraTransform(page, 'source resize baseline');
  const initialBounds = await flyout.boundingBox();
  const handleBounds = await handle.boundingBox();
  assert(initialBounds !== null && handleBounds !== null, 'Source flyout resize geometry was unavailable.');
  await page.mouse.move(handleBounds.x + (handleBounds.width / 2), handleBounds.y + (handleBounds.height / 2));
  await page.mouse.down();
  await page.mouse.move(handleBounds.x - 140, handleBounds.y + (handleBounds.height / 2));
  await page.mouse.up();
  const widenedBounds = await flyout.boundingBox();
  assert(widenedBounds !== null && widenedBounds.width > initialBounds.width + 100,
    `Dragging the source resize separator did not widen the panel: ${JSON.stringify({ initialBounds, widenedBounds })}.`);
  assertAnchorsStable(anchorsBeforeResize, await snapshotAnchors(page, ANCHORS));
  assert(await renderedCanvasCameraTransform(page, 'source resize drag') === cameraBeforeResize,
    'Dragging the source panel separator changed the canvas camera.');

  await handle.focus();
  const widthBeforeKeyboard = Number(await handle.getAttribute('aria-valuenow'));
  await handle.press('ArrowRight');
  const widthAfterArrow = Number(await handle.getAttribute('aria-valuenow'));
  assert(widthAfterArrow < widthBeforeKeyboard, 'ArrowRight did not move the source panel separator toward its minimum width.');
  await handle.press('End');
  const keyboardMaximum = Number(await handle.getAttribute('aria-valuemax'));
  assert(Number(await handle.getAttribute('aria-valuenow')) === keyboardMaximum, 'End did not set the source panel to its accessible maximum width.');
  await handle.press('Home');
  const keyboardMinimum = Number(await handle.getAttribute('aria-valuemin'));
  assert(Number(await handle.getAttribute('aria-valuenow')) === keyboardMinimum, 'Home did not set the source panel to its accessible minimum width.');
  await assertContainedInViewport(page, flyout, 'resized desktop Mermaid source flyout');

  const longSource = `flowchart LR\n  Browser --> API\n  %% ${'a'.repeat(1_200)}`;
  await replaceSource(page, longSource);
  await waitForSource(page, longSource);
  const scrollMetrics = await flyout.locator('.cm-scroller').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    whiteSpace: getComputedStyle(element.querySelector('.cm-content') ?? element).whiteSpace,
  }));
  assert(scrollMetrics.scrollWidth > scrollMetrics.clientWidth,
    `Long Mermaid source line wrapped or was clipped instead of horizontally scrolling: ${JSON.stringify(scrollMetrics)}.`);
  assert(scrollMetrics.whiteSpace === 'pre', `Source editor did not preserve unwrapped code whitespace: ${JSON.stringify(scrollMetrics)}.`);

  const persistedWidth = await flyout.boundingBox();
  await closeFlyout(page, 'source');
  await ensureSourceFlyoutOpen(page);
  const reopenedWidth = await flyout.boundingBox();
  assert(persistedWidth !== null && reopenedWidth !== null && Math.abs(reopenedWidth.width - persistedWidth.width) <= 1,
    `Source flyout width did not persist locally across close/open: ${JSON.stringify({ persistedWidth, reopenedWidth })}.`);
  await closeFlyout(page, 'source');
}

async function expectSourceFlyoutViewportSettlement(page: Page): Promise<void> {
  const beforeAnchors = await snapshotAnchors(page, ANCHORS);
  const beforeCamera = await renderedCanvasCameraTransform(page, 'source flyout viewport stress baseline');
  const canvas = page.getByTestId('diagram-canvas');
  const controls = page.getByTestId('canvas-controls-toolbar');
  const addNode = page.getByRole('button', { name: 'Add node to Mermaid text', exact: true });

  for (let iteration = 1; iteration <= 3; iteration += 1) {
    await ensureSourceFlyoutOpen(page);
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });
    });
    const [canvasBounds, controlBounds, addNodeBounds] = await Promise.all([canvas.boundingBox(), controls.boundingBox(), addNode.boundingBox()]);
    assert(
      canvasBounds && canvasBounds.width > 320 && canvasBounds.height > 120
      && controlBounds && controlBounds.width > 100 && controlBounds.height >= 32
      && addNodeBounds && addNodeBounds.width >= 20 && addNodeBounds.height >= 20,
      `Source flyout open ${iteration} left a canvas control with transient bounds: ${JSON.stringify({ addNodeBounds, canvasBounds, controlBounds })}.`);
    assert(await controls.isVisible() && await addNode.isVisible(),
      `Source flyout open ${iteration} hid canvas controls or Add node after layout settled.`);
    assertAnchorsStable(beforeAnchors, await snapshotAnchors(page, ANCHORS));
    assert(await renderedCanvasCameraTransform(page, `source flyout viewport stress open ${iteration}`) === beforeCamera,
      `Opening source flyout ${iteration} changed the canvas camera.`);
    await closeFlyout(page, 'source');
    assertAnchorsStable(beforeAnchors, await snapshotAnchors(page, ANCHORS));
    assert(await renderedCanvasCameraTransform(page, `source flyout viewport stress close ${iteration}`) === beforeCamera,
      `Closing source flyout ${iteration} changed the canvas camera.`);
  }
}

async function expectFlyoutExclusivity(page: Page): Promise<void> {
  await ensureFlyout(page, 'source');
  await verifiedClick(page, page.getByTestId('activity-flyout-toggle'), 'activity flyout toggle');
  await page.getByTestId('activity-flyout').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('source-flyout').waitFor({ state: 'detached', timeout: 15_000 });
  assert(await page.getByTestId('source-flyout-toggle').getAttribute('aria-expanded') === 'false', 'Source flyout remained expanded behind activity.');
  await closeFlyout(page, 'activity');
}

async function expectFlyoutFocusAndEscape(page: Page): Promise<void> {
  const sourceToggle = page.getByTestId('source-flyout-toggle');
  await verifiedClick(page, sourceToggle, 'source flyout toggle');
  await page.getByTestId('source-flyout').waitFor({ state: 'visible', timeout: 15_000 });
  await page.keyboard.press('Escape');
  await page.getByTestId('source-flyout').waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, 'source-flyout-toggle', 'Closing source with Escape');
  assert(await sourceToggle.evaluate((element) => document.activeElement === element), 'Closing source with Escape did not return focus to its toggle.');

  const activityToggle = page.getByTestId('activity-flyout-toggle');
  await verifiedClick(page, activityToggle, 'activity flyout toggle');
  const closeActivity = page.getByLabel('Close activity and history', { exact: true });
  await closeActivity.waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Close activity and history', undefined, { timeout: 5_000 });
  await saveScreenshot(page, 'issue-14-activity-focus');
  await page.keyboard.press('Escape');
  await page.getByTestId('activity-flyout').waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, 'activity-flyout-toggle', 'Closing activity with Escape');
  assert(await activityToggle.evaluate((element) => document.activeElement === element), 'Closing activity with Escape did not return focus to its toggle.');
}

async function expectGitHubMermaidCopy(page: Page, baseUrl: string): Promise<void> {
  const source = 'flowchart LR\n  Browser --> GitHub';
  await ensureSourceFlyoutOpen(page);
  await replaceSource(page, source);
  await waitForSource(page, source);
  const before = await canonicalSource(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl });
  const copyAction = page.getByTestId('copy-github-mermaid');
  await verifiedClick(page, copyAction, 'Copy for GitHub PR');
  await expect(copyAction).toContainText('Copied for GitHub PR');
  await expect(page.locator('#source-github-copy-status')).toHaveText('GitHub Mermaid block copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('```mermaid\nflowchart LR\n  Browser --> GitHub\n```');
  assert(await canonicalSource(page) === before, 'Copying Mermaid for GitHub changed the canonical source.');

  await page.evaluate(`Object.defineProperty(navigator.clipboard, 'writeText', {
    configurable: true,
    value: function () { return Promise.reject(new Error('Clipboard unavailable')); }
  })`);
  await verifiedClick(page, copyAction, 'Copy for GitHub PR failure state');
  await expect(copyAction).toContainText('Copy failed — try again');
  await expect(page.locator('#source-github-copy-status')).toHaveText('Could not copy the GitHub Mermaid block.');
  assert(await canonicalSource(page) === before, 'A failed GitHub copy changed the canonical source.');
  await expect(copyAction).toContainText('Copy for GitHub PR', { timeout: 3_000 });
}

async function expectTabKeyboardAndRename(page: Page, created: string): Promise<string> {
  await selectTabByName(page, created);
  const renamed = 'API timing';
  await renameActiveDiagram(page, renamed);
  await saveScreenshot(page, 'issue-14-rename');
  const mainTab = page.getByRole('tab', { name: 'Main', exact: true });
  await mainTab.focus();
  await mainTab.press('ArrowRight');
  assert(await activeTabName(page) === renamed, 'ArrowRight did not activate the next diagram tab.');
  await page.getByRole('tab', { name: renamed, exact: true }).press('ArrowLeft');
  assert(await activeTabName(page) === 'Main', 'ArrowLeft did not activate the previous diagram tab.');
  await selectTabByName(page, renamed);
  assert(created !== renamed, 'Renaming a blank tab did not change its label.');
  return renamed;
}

async function expectMermaidStatesAndToolbar(page: Page): Promise<void> {
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await waitForFlowchartFixtureRender(page);
  await expectSourceFlyoutViewportSettlement(page);
  await expectCanvasCameraControlHitTargets(page, 'closed-flyout canvas controls');
  await saveScreenshot(page, 'issue-14-source');
  await closeFlyout(page, 'source');
  await saveScreenshot(page, 'issue-14-light-canvas');
  await ensureSourceFlyoutOpen(page);
  await expectCanvasCameraControlHitTargets(page, 'source-flyout canvas controls');
  const nodeLabel = page.getByRole('textbox', { name: 'New node label', exact: true });
  await nodeLabel.fill('Toolbar node');
  await verifiedClick(page, page.getByRole('button', { name: 'Add node to Mermaid text', exact: true }), 'add node toolbar');
  await page.waitForFunction(() => [...document.querySelectorAll('.cm-line')].some((line) => line.textContent?.includes('Toolbar node')), undefined, { timeout: 15_000 });
  assert((await page.locator('.cm-content').textContent())?.includes('Toolbar node'), 'Add-node toolbar did not write Mermaid source.');

  const firstNode = page.locator('.mermaid-flow-node').first();
  await verifiedClick(page, firstNode, 'first diagram node');
  const nodeToolbar = page.getByTestId('canvas-node-toolbar');
  await nodeToolbar.waitFor({ state: 'visible', timeout: 15_000 });
  for (const label of ['Edit label', 'Change shape', 'Connect nodes', 'Delete selected nodes', 'Add node']) {
    await assertHitTarget(page, nodeToolbar.getByRole('button', { name: label, exact: true }), `node toolbar ${label}`);
  }
  for (const [label, hint, title] of [
    ['Edit label', 'F2', 'Edit label (F2)'],
    ['Connect nodes', 'C', 'Connect nodes (C)'],
    ['Delete selected nodes', '⌫', 'Delete selected nodes (Delete or Backspace)'],
    ['Add node', 'N', 'Add node (N)'],
  ] as const) {
    const action = nodeToolbar.getByRole('button', { name: label, exact: true });
    await expect(action.locator('.canvas-toolbar-shortcut')).toHaveText(hint);
    assert(await action.getAttribute('title') === title, `${label} must retain its full shortcut in the tooltip.`);
  }
  const copyAction = nodeToolbar.getByRole('button', { name: 'Copy selected nodes', exact: true });
  await expect(copyAction.locator('.canvas-toolbar-shortcut')).toHaveText('C');
  assert(await copyAction.getAttribute('title') === 'Copy selected nodes (Ctrl/Cmd+C)', 'Copy must retain its full shortcut in the tooltip.');
  await verifiedClick(page, copyAction, 'node toolbar Copy selected nodes');
  const pasteAction = page.getByRole('button', { name: 'Paste copied nodes', exact: true });
  await pasteAction.waitFor({ state: 'visible', timeout: 15_000 });
  await expect(pasteAction.locator('.canvas-toolbar-shortcut')).toHaveText('V');
  assert(await pasteAction.getAttribute('title') === 'Paste copied nodes (Ctrl/Cmd+V)', 'Paste must retain its full shortcut in the tooltip.');
  const nodesBeforePasteAction = await page.locator('.mermaid-flow-node').count();
  await verifiedClick(page, pasteAction, 'canvas controls Paste copied nodes');
  await expect.poll(() => page.locator('.mermaid-flow-node').count(), {
    message: 'Clicking the visible Paste copied nodes control did not add its copied node.',
    timeout: 15_000,
  }).toBeGreaterThan(nodesBeforePasteAction);
  const simplifyAction = page.getByRole('button', { name: 'Simplify layout', exact: true });
  await simplifyAction.waitFor({ state: 'visible', timeout: 15_000 });
  await verifiedClick(page, simplifyAction, 'canvas controls Simplify layout');
  await simplifyAction.waitFor({ state: 'detached', timeout: 15_000 });
  await verifiedClick(page, firstNode, 'first diagram node after simplifying pasted layout');
  await nodeToolbar.waitFor({ state: 'visible', timeout: 15_000 });
  await verifiedClick(page, nodeToolbar.getByRole('button', { name: 'Add node', exact: true }), 'node toolbar Add node');
  await page.waitForFunction(() => [...document.querySelectorAll('.cm-line')].some((line) => line.textContent?.includes('New Node')), undefined, { timeout: 15_000 });
  await verifiedClick(page, firstNode, 'first diagram node after add');
  await verifiedClick(page, nodeToolbar.getByRole('button', { name: 'Change shape', exact: true }), 'node toolbar Change shape');
  await verifiedClick(page, page.getByRole('button', { name: 'diamond', exact: true }), 'diamond shape picker action');
  await verifiedClick(page, firstNode, 'first diagram node after shape change');
  await verifiedClick(page, nodeToolbar.getByRole('button', { name: 'Connect nodes', exact: true }), 'node toolbar Connect nodes');
  await page.getByText('click target node [esc cancel]', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('diagram-canvas').press('Escape');

  await replaceSource(page, CONNECT_SOURCE_SAFE_FIXTURE);
  await waitForSource(page, CONNECT_SOURCE_SAFE_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await closeFlyout(page, 'source');
  const sourceNode = page.locator('.mermaid-flow-node').filter({ hasText: 'Session A (Worker 1)' }).first();
  const targetNode = page.locator('.mermaid-flow-node').filter({ hasText: 'Session B (Worker 2)' }).first();
  await verifiedClick(page, sourceNode, 'parenthetical source node');
  await nodeToolbar.waitFor({ state: 'visible', timeout: 15_000 });
  await verifiedClick(page, nodeToolbar.getByRole('button', { name: 'Connect nodes', exact: true }), 'seeded Connect nodes action');
  await page.getByText('click target node [esc cancel]', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await verifiedClick(page, targetNode, 'parenthetical target node');
  const edgeLabel = page.getByPlaceholder('label (optional)', { exact: true });
  await edgeLabel.waitFor({ state: 'visible', timeout: 15_000 });
  await edgeLabel.press('Enter');
  const expectedConnectedSource = `${CONNECT_SOURCE_SAFE_FIXTURE}\n  Source --> Target\n`;
  await ensureSourceFlyoutOpen(page);
  await waitForSource(page, expectedConnectedSource);
  await waitForCanvas(page, 'flowchart');
  assert((await canonicalSource(page)).includes('Source["Session A (Worker 1)"]:::worker'),
    'Connecting parenthetical nodes rewrote the existing quoted source semantics.');
  assert(await page.getByTestId('source-parse-status').count() === 0,
    'Connecting parenthetical nodes produced a Mermaid parse error instead of a rendered flowchart.');
  await closeFlyout(page, 'source');
  await saveScreenshot(page, 'issue-14-flowchart-selected');

  await expectUnclippedShapeHandles(page);

  await replaceSource(page, SOURCE_OWNED_COLOR_FIXTURE);
  await waitForSource(page, SOURCE_OWNED_COLOR_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  const coloredNode = page.locator('.mermaid-flow-node-surface').filter({ hasText: 'Browser' }).first();
  const expectedSourceOwnedColors = {
    background: 'rgb(255, 236, 153)',
    border: 'rgb(217, 72, 15)',
    text: 'rgb(74, 44, 0)',
  };
  const sourceOwnedColors = await waitForNodeColors(
    coloredNode,
    expectedSourceOwnedColors,
    'Light source-owned Mermaid classDef',
  );
  assertExactColor(sourceOwnedColors.background, 'rgb(255, 236, 153)', 'Mermaid classDef #ffec99 fill');
  assertExactColor(sourceOwnedColors.border, 'rgb(217, 72, 15)', 'Mermaid classDef #d9480f stroke');
  assertExactColor(sourceOwnedColors.text, 'rgb(74, 44, 0)', 'Mermaid classDef #4a2c00 text');
  await selectThemePreference(page, 'dark');
  const afterThemeColors = await waitForNodeColors(
    coloredNode,
    expectedSourceOwnedColors,
    'Dark source-owned Mermaid classDef',
  );
  assertExactColor(afterThemeColors.background, 'rgb(255, 236, 153)', 'Dark Mermaid classDef #ffec99 fill');
  assertExactColor(afterThemeColors.border, 'rgb(217, 72, 15)', 'Dark Mermaid classDef #d9480f stroke');
  assertExactColor(afterThemeColors.text, 'rgb(74, 44, 0)', 'Dark Mermaid classDef #4a2c00 text');
  await closeFlyout(page, 'source');
  await saveScreenshot(page, 'issue-14-dark-canvas');
  await selectThemePreference(page, 'light');

  await replaceSource(page, TRANSPARENT_MERMAID_FIXTURE);
  await waitForSource(page, TRANSPARENT_MERMAID_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  const transparentNode = page.locator('.mermaid-flow-node-surface').filter({ hasText: 'Ghost' }).first();
  const transparentColors = await waitForNodeColors(transparentNode, {
    background: 'rgba(0, 0, 0, 0)',
    border: 'rgba(0, 0, 0, 0)',
    text: 'rgba(0, 0, 0, 0)',
  }, 'Transparent source-owned Mermaid classDef');
  assertExactColor(transparentColors.background, 'rgba(0, 0, 0, 0)', 'Mermaid fill:none background');
  assertExactColor(transparentColors.border, 'rgba(0, 0, 0, 0)', 'Mermaid transparent stroke');
  assertExactColor(transparentColors.text, 'rgba(0, 0, 0, 0)', 'Mermaid transparent text');

  await replaceSource(page, API_SEQUENCE_FIXTURE);
  await waitForCanvas(page, 'sequence');
  assert(await page.locator('form[aria-label="Add Mermaid node"]').count() === 0, 'Sequence Mermaid retained flowchart mutation controls.');
  await closeFlyout(page, 'source');
  await saveScreenshot(page, 'issue-14-sequence-static');

  await replaceSource(page, INVALID_MERMAID_FIXTURE);
  await waitForInvalidPreview(page);
  await saveScreenshot(page, 'issue-14-invalid');
}

async function expectRendererTransitionPreservesCamera(page: Page): Promise<void> {
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await closeFlyout(page, 'source');
  await triggerCanvasFit(page, 'flowchart fit diagram');
  await assertDotGridTransition(page, false, 'React Flow fit');
  const beforeZoom = await waitForStableCanvasTransform(page, 'Flowchart zoom verification');
  const beforeFlowchartGrid = await assertDotGridTracksCamera(page, 'Flowchart grid baseline');
  await verifiedClick(page, page.getByRole('button', { name: 'Zoom in', exact: true }), 'zoom in');
  await page.waitForFunction((previous) => {
    const layer = document.querySelector('.diagram-canvas-svg')?.parentElement;
    return layer instanceof HTMLElement && layer.style.transform !== previous;
  }, beforeZoom, { timeout: 5_000 });
  const zoomed = await waitForStableCanvasTransform(page, 'Flowchart zoom result');
  assert(zoomed !== beforeZoom, `Zoom in did not change the flowchart camera: ${beforeZoom}`);
  const zoomedFlowchartGrid = await assertDotGridTracksCamera(page, 'Flowchart grid after zoom');
  assert(JSON.stringify(zoomedFlowchartGrid) !== JSON.stringify(beforeFlowchartGrid),
    'Flowchart zoom did not change the dot-grid visual state.');
  await dispatchTouchDrag(page, 'Flowchart grid pan');
  const pannedFlowchartTransform = await waitForCameraChange(page, zoomed, 'Flowchart grid pan');
  const pannedFlowchartGrid = await assertDotGridTracksCamera(page, 'Flowchart grid after pan');
  assert(JSON.stringify(pannedFlowchartGrid) !== JSON.stringify(zoomedFlowchartGrid),
    'Flowchart pan did not change the dot-grid visual state.');
  await replaceSource(page, API_SEQUENCE_FIXTURE);
  await waitForCanvas(page, 'sequence');
  await closeFlyout(page, 'source');
  const staticTransform = await waitForStableCanvasTransform(page, 'Static renderer transition');
  assert(staticTransform === pannedFlowchartTransform, `Editable-to-static renderer transition changed the camera: ${pannedFlowchartTransform} -> ${staticTransform}`);
  const staticGrid = await assertDotGridTracksCamera(page, 'Generic renderer grid after transition');
  assert(JSON.stringify(staticGrid) === JSON.stringify(pannedFlowchartGrid),
    'Renderer transition changed the dot grid despite preserving the shared camera.');
  await triggerCanvasFit(page, 'static renderer fit diagram');
  await assertDotGridTransition(
    page,
    true,
    'Generic Mermaid fit',
  );
  await page.waitForFunction((previous) => {
    const layer = document.querySelector('.diagram-canvas-svg')?.parentElement;
    return layer instanceof HTMLElement && layer.style.transform !== previous;
  }, staticTransform, { timeout: 5_000 });
  const fittedTransform = await waitForStableCanvasTransform(page, 'Static renderer explicit Fit result');
  assert(fittedTransform !== staticTransform, `Explicit Fit did not change the static renderer camera: ${staticTransform}`);
  const fittedGenericGrid = await assertDotGridTracksCamera(page, 'Generic renderer grid after fit');
  assert(JSON.stringify(fittedGenericGrid) !== JSON.stringify(staticGrid),
    'Generic renderer Fit did not change the dot-grid visual state.');
  await dispatchTouchDrag(page, 'Generic grid pan');
  const pannedGenericTransform = await waitForCameraChange(page, fittedTransform, 'Generic grid pan');
  const pannedGenericGrid = await assertDotGridTracksCamera(page, 'Generic renderer grid after pan');
  assert(JSON.stringify(pannedGenericGrid) !== JSON.stringify(fittedGenericGrid),
    'Generic renderer pan did not change the dot-grid visual state.');
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await closeFlyout(page, 'source');
  const restoredFlowchartTransform = await waitForStableCanvasTransform(page, 'Flowchart renderer restoration');
  assert(restoredFlowchartTransform === pannedGenericTransform,
    `Static-to-editable renderer transition changed the camera: ${pannedGenericTransform} -> ${restoredFlowchartTransform}`);
  const restoredFlowchartGrid = await assertDotGridTracksCamera(page, 'Flowchart grid after restoration');
  assert(JSON.stringify(restoredFlowchartGrid) === JSON.stringify(pannedGenericGrid),
    'Static-to-editable renderer transition changed the dot grid despite preserving the shared camera.');
}

async function expectRemoteUpdateWithoutAnchorJump(page: Page, mcp: ModernMcpClient, sessionId: string, diagramName: string): Promise<void> {
  await selectTabByName(page, diagramName);
  await ensureSourceFlyoutOpen(page);
  await waitForSyncedSource(page);
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await waitForFlowchartFixtureRender(page);
  const session = await mcp.getSession(sessionId);
  const diagram = session.diagrams.find((candidate) => candidate.name === diagramName);
  assert(diagram, `MCP did not expose diagram ${diagramName}.`);
  const before = await snapshotAnchors(page, ANCHORS);
  const beforeCamera = await waitForStableCanvasTransform(page, 'Remote flowchart update camera baseline');
  const remoteSource = `${FLOWCHART_FIXTURE}\n  Gateway --> Audit[Audit]`;
  await mcp.writeLatest(sessionId, diagram.id, remoteSource);
  await waitForSource(page, remoteSource);
  await page.locator('.mermaid-flow-node').filter({ hasText: 'Audit' }).first().waitFor({ state: 'visible', timeout: 15_000 });
  const afterCamera = await waitForStableCanvasTransform(page, 'Remote flowchart update camera result');
  assert(afterCamera === beforeCamera, `Same-renderer remote update changed the camera: ${beforeCamera} -> ${afterCamera}`);
  assertAnchorsStable(before, await snapshotAnchors(page, ANCHORS));
}

async function expectThemeContract(page: Page): Promise<void> {
  const trigger = page.getByTestId(SETTINGS_TRIGGER_TEST_ID);
  assert(await trigger.count() === 1, 'Accessible workspace settings trigger is missing from workspace chrome.');
  await assertHitTarget(page, trigger, 'workspace settings trigger');
  await assertContainedInViewport(page, trigger, 'workspace settings trigger');

  await selectThemePreference(page, 'light');
  await page.locator('html[data-theme="light"]').waitFor({ state: 'attached', timeout: 5_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('html[data-theme="light"]').waitFor({ state: 'attached', timeout: 5_000 });

  await selectThemePreference(page, 'dark');
  await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached', timeout: 5_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached', timeout: 5_000 });

  await page.emulateMedia({ colorScheme: 'light' });
  const storagePeer = await page.context().newPage();
  try {
    await storagePeer.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await storagePeer.evaluate(() => window.localStorage.clear());
    await page.locator('html[data-theme="light"]').waitFor({ state: 'attached', timeout: 5_000 });
    assert(await page.evaluate(() => window.localStorage.getItem('arielcharts.theme.v1')) === null,
      'Clearing theme storage in a peer tab did not reset this tab to the system preference.');
  } finally {
    await storagePeer.close();
  }

  await selectThemePreference(page, 'light');
  await selectThemePreference(page, 'system');
  await page.locator('html[data-theme="light"]').waitFor({ state: 'attached', timeout: 5_000 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached', timeout: 5_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert(await page.evaluate(() => window.localStorage.getItem('arielcharts.theme.v1')) === 'system', 'System theme preference did not persist across reload.');
  await selectThemePreference(page, 'system');
}

async function openAgentConnectionModal(page: Page, actionLabel: 'Connect my agent' | 'Connection details'): Promise<Locator> {
  const settings = await openWorkspaceSettings(page);
  await verifiedClick(page, settings.getByRole('button', { name: actionLabel, exact: true }), `settings ${actionLabel} action`);
  const modal = page.getByRole('dialog', { name: 'Agent connection', exact: true });
  await modal.waitFor({ state: 'visible', timeout: 15_000 });
  await waitForFocusedLocator(page, modal.getByRole('button', { name: 'Close', exact: true }), 'Opening agent connection modal');
  return modal;
}

async function expectAgentConnectionModal(
  page: Page,
  mcpUrl: string,
  sessionId: string,
  roomCookie: string,
  expectedKeyAvailability: 'in-memory' | 'cookie-only',
): Promise<void> {
  await ensureFlyout(page, 'source');
  const zeroAgentModal = await openAgentConnectionModal(page, 'Connect my agent');
  const zeroAgentDetails = zeroAgentModal.getByTestId('agent-connection-details');
  assert(/Session status\s+(Connected|Connecting|Reconnecting|Disconnected)/u.test(await zeroAgentDetails.innerText()),
    `Agent connection modal omitted the session status: ${JSON.stringify(await zeroAgentDetails.innerText())}.`);
  assert(/Agents\s+0 MCP agents connected/u.test(await zeroAgentDetails.innerText()),
    `Agent connection modal omitted the zero-agent detail: ${JSON.stringify(await zeroAgentDetails.innerText())}.`);
  const prompt = zeroAgentModal.locator('.modal-prompt-text');
  await saveScreenshot(page, 'issue-28-agent-connection-modal');
  const closeAction = zeroAgentModal.getByRole('button', { name: 'Close', exact: true });
  if (expectedKeyAvailability === 'in-memory') {
    assert(await prompt.count() === 1, 'Fragment-derived room key was not available for the agent bearer prompt.');
    assert((await prompt.innerText()).includes('First call getSession'), 'Agent connection modal omitted the current-session MCP prompt.');
    const copyAction = zeroAgentModal.locator('.modal-prompt-copy');
    await verifiedClick(page, copyAction, 'agent prompt copy action');
    await page.waitForFunction(() => /^(copied|copy failed)$/iu.test(document.querySelector('.modal-prompt-copy')?.textContent ?? ''), undefined, { timeout: 5_000 });
    await closeAction.press('Shift+Tab');
    await waitForFocusedLocator(page, copyAction, 'Reverse Tab wrapping in agent connection modal');
    await copyAction.press('Tab');
    await waitForFocusedLocator(page, closeAction, 'Forward Tab wrapping in agent connection modal');
  } else {
    assert(await prompt.count() === 0, 'Cookie-only reload rendered a raw room-key agent prompt.');
    await zeroAgentModal.getByText(/no shareable key in memory/i).waitFor({ state: 'visible', timeout: 5_000 });
  }
  await page.keyboard.press('Escape');
  await zeroAgentModal.waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, SETTINGS_TRIGGER_TEST_ID, 'Escaping agent connection modal');
  await page.getByTestId('source-flyout').waitFor({ state: 'visible', timeout: 15_000 });
  await closeFlyout(page, 'source');

  const backdropModal = await openAgentConnectionModal(page, 'Connect my agent');
  await page.locator('.modal-backdrop').click({ position: { x: 4, y: 4 } });
  await backdropModal.waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, SETTINGS_TRIGGER_TEST_ID, 'Backdrop-closing agent connection modal');

  const closeButtonModal = await openAgentConnectionModal(page, 'Connect my agent');
  await verifiedClick(page, closeButtonModal.getByRole('button', { name: 'Close', exact: true }), 'close agent connection modal');
  await closeButtonModal.waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, SETTINGS_TRIGGER_TEST_ID, 'Closing agent connection modal');

  const agent = await connectAgentPresence(mcpUrl, sessionId, roomCookie, new URL(page.url()).origin);
  try {
    const settings = await openWorkspaceSettings(page);
    await page.waitForFunction(() => document.querySelector('[data-testid="workspace-agent-status"]')?.textContent?.includes('1 MCP agent working') ?? false, undefined, { timeout: 15_000 });
    await settings.getByRole('button', { name: 'Connection details', exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
    await closeWorkspaceSettings(page);
    const activeAgentModal = await openAgentConnectionModal(page, 'Connection details');
    const activeAgentDetails = activeAgentModal.getByTestId('agent-connection-details');
    assert(/Agents\s+1 MCP agent connected/u.test(await activeAgentDetails.innerText()),
      `Agent connection modal omitted the active-agent detail: ${JSON.stringify(await activeAgentDetails.innerText())}.`);
    await page.keyboard.press('Escape');
    await activeAgentModal.waitFor({ state: 'detached', timeout: 15_000 });
    await waitForFocusedTestId(page, SETTINGS_TRIGGER_TEST_ID, 'Escaping active-agent connection details');
  } finally {
    agent.destroy();
    const settings = await openWorkspaceSettings(page);
    await expect(settings.getByTestId('workspace-agent-status')).not.toContainText('MCP agent working', { timeout: 15_000 });
    await closeWorkspaceSettings(page);
  }
}

async function expectWorkspaceSettings(page: Page, mcpUrl: string, sessionId: string, roomCookie: string): Promise<void> {
  const trigger = page.getByTestId(SETTINGS_TRIGGER_TEST_ID);
  const before = await snapshotAnchors(page, ANCHORS);
  const beforeTransform = await canvasTransform(page);
  const dialog = await openWorkspaceSettings(page);
  await assertContainedInViewport(page, dialog, 'desktop workspace settings dialog');
  const nameInput = dialog.getByRole('textbox', { name: 'Display name', exact: true });
  await waitForFocusedLocator(page, nameInput, 'Opening workspace settings');
  await dialog.getByRole('heading', { name: 'You', exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
  await dialog.getByRole('heading', { name: /^Agent/u }).waitFor({ state: 'visible', timeout: 5_000 });
  await dialog.getByRole('group', { name: 'Appearance', exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
  const status = dialog.getByTestId('workspace-agent-status');
  await status.waitFor({ state: 'visible', timeout: 5_000 });
  assert(/ready for agents|connecting session|reconnecting session|session offline|mcp agents? working/iu.test(await status.innerText()),
    `Workspace settings agent status does not communicate session state: ${JSON.stringify(await status.innerText())}.`);
  const agentAction = dialog.getByRole('button', { name: /^(Connect my agent|Connection details)$/u });
  await assertHitTarget(page, agentAction, 'workspace settings agent action');
  for (const preference of ['System', 'Light', 'Dark']) {
    await dialog.getByRole('radio', { name: new RegExp(`^${preference}(?:\\s|$)`, 'u') }).waitFor({ state: 'visible', timeout: 5_000 });
  }
  await saveScreenshot(page, 'issue-28-light-flat-settings');

  const originalName = await nameInput.inputValue();
  const savedName = 'Ariel UX E2E';
  await nameInput.fill(savedName);
  await verifiedClick(page, dialog.getByRole('button', { name: 'Save name', exact: true }), 'settings save display name');
  await page.getByTestId(SETTINGS_DIALOG_TEST_ID).waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, SETTINGS_TRIGGER_TEST_ID, 'Saving display name');

  const reopenedAfterSave = await openWorkspaceSettings(page);
  const savedInput = reopenedAfterSave.getByRole('textbox', { name: 'Display name', exact: true });
  assert(await savedInput.inputValue() === savedName, 'Saving display name did not retain the edited value.');
  await savedInput.fill('Discarded by cancel');
  await verifiedClick(page, reopenedAfterSave.getByRole('button', { name: 'Cancel', exact: true }), 'settings cancel display name');
  await page.getByTestId(SETTINGS_DIALOG_TEST_ID).waitFor({ state: 'detached', timeout: 15_000 });

  const reopenedAfterCancel = await openWorkspaceSettings(page);
  const escapedInput = reopenedAfterCancel.getByRole('textbox', { name: 'Display name', exact: true });
  assert(await escapedInput.inputValue() === savedName, 'Cancelling display-name edit changed the saved value.');
  const draftName = 'Draft survives agent presence';
  await escapedInput.fill(draftName);
  const draftAgent = await connectAgentPresence(mcpUrl, sessionId, roomCookie, new URL(page.url()).origin);
  try {
    await expect(reopenedAfterCancel.getByTestId('workspace-agent-status')).toContainText('1 MCP agent working', { timeout: 15_000 });
    assert(await escapedInput.inputValue() === draftName, 'An unrelated collaboration rerender reset the in-progress display-name draft.');
  } finally {
    draftAgent.destroy();
    await expect(reopenedAfterCancel.getByTestId('workspace-agent-status')).not.toContainText('MCP agent working', { timeout: 15_000 });
  }
  await escapedInput.fill('Discarded by escape');
  await page.keyboard.press('Escape');
  await page.getByTestId(SETTINGS_DIALOG_TEST_ID).waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, SETTINGS_TRIGGER_TEST_ID, 'Closing settings with Escape');

  const reopenedAfterEscape = await openWorkspaceSettings(page);
  const restoredInput = reopenedAfterEscape.getByRole('textbox', { name: 'Display name', exact: true });
  await page.waitForFunction((expected) => (document.querySelector('#workspace-display-name') as HTMLInputElement | null)?.value === expected, savedName, { timeout: 5_000 });
  assert(await restoredInput.inputValue() === savedName, 'Escaping display-name edit changed the saved value.');
  await restoredInput.fill(originalName);
  await verifiedClick(page, reopenedAfterEscape.getByRole('button', { name: 'Save name', exact: true }), 'restore display name after settings test');
  await page.getByTestId(SETTINGS_DIALOG_TEST_ID).waitFor({ state: 'detached', timeout: 15_000 });

  const backwardBoundary = await openWorkspaceSettings(page);
  await backwardBoundary.getByRole('button', { name: 'Close', exact: true }).press('Shift+Tab');
  await backwardBoundary.waitFor({ state: 'detached', timeout: 15_000 });
  assert(await page.evaluate(() => !document.querySelector('[data-testid="workspace-settings-dialog"]')?.contains(document.activeElement)),
    'Shift+Tab at the start of settings trapped focus in the dialog.');

  const forwardBoundary = await openWorkspaceSettings(page);
  const checkedTheme = forwardBoundary.locator('input[type="radio"]:checked');
  await checkedTheme.press('Tab');
  await forwardBoundary.waitFor({ state: 'detached', timeout: 15_000 });
  assert(await page.evaluate(() => !document.querySelector('[data-testid="workspace-settings-dialog"]')?.contains(document.activeElement)),
    'Tab at the end of settings trapped focus in the dialog.');

  await openWorkspaceSettings(page);
  await page.locator('.workspace-logo').click();
  await page.getByTestId(SETTINGS_DIALOG_TEST_ID).waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, SETTINGS_TRIGGER_TEST_ID, 'Outside-closing settings from inert page chrome');

  await openWorkspaceSettings(page);
  const mainTab = page.getByRole('tab', { name: 'Main', exact: true });
  await verifiedClick(page, mainTab, 'selecting a tab outside settings');
  await page.getByTestId(SETTINGS_DIALOG_TEST_ID).waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedLocator(page, mainTab, 'Selecting a tab outside settings');
  assert(await trigger.evaluate((element) => document.activeElement !== element),
    'Opening an interactive control outside settings had its focus stolen by the settings trigger.');

  const canvas = page.getByRole('application', { name: 'Interactive diagram canvas', exact: true });
  await openWorkspaceSettings(page);
  await canvas.focus();
  await canvas.click({ position: { x: 4, y: 4 } });
  await page.getByTestId(SETTINGS_DIALOG_TEST_ID).waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedLocator(page, canvas, 'Closing settings from the interactive canvas');
  assert(await trigger.evaluate((element) => document.activeElement !== element),
    'Closing settings from the interactive canvas had its focus stolen by the settings trigger.');

  await ensureFlyout(page, 'source');
  await openWorkspaceSettings(page);
  await page.getByTestId('source-flyout').waitFor({ state: 'visible', timeout: 15_000 });
  await closeWorkspaceSettings(page);
  await page.getByTestId('source-flyout').waitFor({ state: 'visible', timeout: 15_000 });
  await closeFlyout(page, 'source');
  await ensureFlyout(page, 'activity');
  await openWorkspaceSettings(page);
  await page.getByTestId('activity-flyout').waitFor({ state: 'visible', timeout: 15_000 });
  await closeWorkspaceSettings(page);
  await page.getByTestId('activity-flyout').waitFor({ state: 'visible', timeout: 15_000 });
  await closeFlyout(page, 'activity');
  await openTemplateMenu(page);
  await openWorkspaceSettings(page);
  await page.getByRole('menu', { name: 'Starter templates', exact: true }).waitFor({ state: 'detached', timeout: 15_000 });
  await closeWorkspaceSettings(page);

  assertAnchorsStable(before, await snapshotAnchors(page, ANCHORS));
  assert(await canvasTransform(page) === beforeTransform, 'Opening and closing workspace settings changed the canvas camera.');
}

async function assertNoProductShadows(page: Page, selectors: Record<string, string>): Promise<void> {
  const shadowAudit = await page.evaluate((entries) => Object.fromEntries(entries.map(([label, selector]) => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) return [label, null];
    const style = getComputedStyle(element);
    return [label, { boxShadow: style.boxShadow, filter: style.filter }];
  })), Object.entries(selectors)) as Record<string, { boxShadow: string; filter: string } | null>;
  for (const [label, style] of Object.entries(shadowAudit)) {
    assert(style !== null, `Flat chrome audit could not find ${label}.`);
    assert(style.boxShadow === 'none', `${label} retained product box-shadow: ${style.boxShadow}.`);
    assert(!style.filter.includes('drop-shadow'), `${label} retained product drop-shadow filter: ${style.filter}.`);
  }
}

async function expectFlatChrome(page: Page): Promise<void> {
  await ensureFlyout(page, 'source');
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await waitForFlowchartFixtureRender(page);
  const outerNode = page.locator('.diagram-reactflow-layer .react-flow__node').first();
  const visibleNode = outerNode.locator('.mermaid-flow-node');
  const selectedEdge = page.locator('.diagram-reactflow-layer .react-flow__edge').first();
  const edgePath = selectedEdge.locator('.react-flow__edge-path');
  const edgeInteraction = selectedEdge.locator('.react-flow__edge-interaction');
  await outerNode.waitFor({ state: 'visible', timeout: 15_000 });
  await edgePath.waitFor({ state: 'attached', timeout: 15_000 });
  await outerNode.hover();
  await assertNoProductShadows(page, {
    hoveredOuterNode: '.diagram-reactflow-layer .react-flow__node:hover',
  });
  await verifiedClick(page, outerNode, 'outer React Flow node selection for flat chrome audit');
  await expect(visibleNode).toHaveClass(/is-selected/u, { timeout: 5_000 });
  const selectedNodeStyles = await outerNode.evaluate((element) => {
    const visibleSurface = element.querySelector<HTMLElement>('.mermaid-flow-node-surface');
    if (!visibleSurface) throw new Error('Selected outer React Flow node has no visible Mermaid node surface.');
    const outerStyle = getComputedStyle(element);
    const visibleStyle = getComputedStyle(visibleSurface);
    return {
      background: visibleStyle.backgroundColor,
      boxShadow: outerStyle.boxShadow,
      filter: outerStyle.filter,
      outline: visibleStyle.outlineStyle,
    };
  });
  assert(selectedNodeStyles.boxShadow === 'none' && !selectedNodeStyles.filter.includes('drop-shadow'),
    `Selected outer React Flow node retained elevation: ${JSON.stringify(selectedNodeStyles)}.`);
  assert(selectedNodeStyles.outline !== 'none' || selectedNodeStyles.background !== 'rgba(0, 0, 0, 0)',
    `Selected node has no visible flat selection treatment: ${JSON.stringify(selectedNodeStyles)}.`);
  const unselectedEdgeStyles = await edgePath.evaluate((element) => {
    const style = getComputedStyle(element);
    return { stroke: style.stroke, strokeWidth: style.strokeWidth };
  });
  await edgeInteraction.evaluate((element) => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, cancelable: true, view: window }));
  });
  await expect(selectedEdge).toHaveClass(/selected/u, { timeout: 5_000 });
  await selectedEdge.evaluate((element) => {
    if (!element.classList.contains('selected')) {
      throw new Error('React Flow edge did not enter its selected state.');
    }
  });
  const selectedEdgeStyles = await selectedEdge.evaluate((element) => {
    const path = element.querySelector<SVGPathElement>('.react-flow__edge-path');
    if (!path) throw new Error('Selected React Flow edge has no visible path.');
    const edgeStyle = getComputedStyle(element);
    const pathStyle = getComputedStyle(path);
    return {
      edgeBoxShadow: edgeStyle.boxShadow,
      edgeFilter: edgeStyle.filter,
      pathBoxShadow: pathStyle.boxShadow,
      pathFilter: pathStyle.filter,
      stroke: pathStyle.stroke,
      strokeWidth: pathStyle.strokeWidth,
    };
  });
  assert(selectedEdgeStyles.edgeBoxShadow === 'none' && selectedEdgeStyles.pathBoxShadow === 'none'
    && !selectedEdgeStyles.edgeFilter.includes('drop-shadow') && !selectedEdgeStyles.pathFilter.includes('drop-shadow'),
  `Selected React Flow edge retained elevation: ${JSON.stringify(selectedEdgeStyles)}.`);
  assert(selectedEdgeStyles.stroke !== unselectedEdgeStyles.stroke || selectedEdgeStyles.strokeWidth !== unselectedEdgeStyles.strokeWidth,
    `Selected edge did not receive a visible flat selection treatment: ${JSON.stringify({ selectedEdgeStyles, unselectedEdgeStyles })}.`);
  await saveScreenshot(page, 'issue-28-selected-flat-edge');
  await assertNoProductShadows(page, {
    canvasToolbar: '[data-testid="canvas-controls-toolbar"]',
    source: '[data-testid="source-flyout"]',
  });
  await closeFlyout(page, 'source');
  await ensureFlyout(page, 'activity');
  await assertNoProductShadows(page, {
    activity: '[data-testid="activity-flyout"]',
    canvasToolbar: '[data-testid="canvas-controls-toolbar"]',
  });
  await closeFlyout(page, 'activity');
  const templateMenu = await openTemplateMenu(page);
  await assertNoProductShadows(page, {
    canvasToolbar: '[data-testid="canvas-controls-toolbar"]',
    menu: '[role="menu"][aria-label="Starter templates"]',
    templateCard: '[role="menuitem"]',
  });
  const settings = await openWorkspaceSettings(page);
  await templateMenu.waitFor({ state: 'detached', timeout: 15_000 });
  await assertNoProductShadows(page, {
    canvasToolbar: '[data-testid="canvas-controls-toolbar"]',
    settings: '[data-testid="workspace-settings-dialog"]',
  });
  const selectionStyles = await settings.evaluate((dialog) => {
    const selectedTheme = document.querySelector<HTMLElement>('.workspace-settings-theme-option:has(input:checked)');
    return {
      selectedBackground: selectedTheme ? getComputedStyle(selectedTheme).backgroundColor : '',
      selectedOutline: selectedTheme ? getComputedStyle(selectedTheme).outlineStyle : '',
    };
  });
  assert(selectionStyles.selectedBackground !== 'rgba(0, 0, 0, 0)' || selectionStyles.selectedOutline !== 'none',
    'Flat chrome removed the visible selected-theme treatment.');
  await saveScreenshot(page, 'issue-28-dark-flat-chrome');
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await waitForFocusedTestId(page, SETTINGS_TRIGGER_TEST_ID, 'Closing settings after flat chrome audit');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  const focusStyles = await page.getByTestId(SETTINGS_TRIGGER_TEST_ID).evaluate((element) => ({
    isFocusVisible: element.matches(':focus-visible'),
    outline: getComputedStyle(element).outlineStyle,
  }));
  assert(focusStyles.isFocusVisible && focusStyles.outline !== 'none',
    `Flat chrome removed the visible keyboard focus treatment: ${JSON.stringify(focusStyles)}.`);
}

async function expectUnstyledNodesUseNeutralThemeColors(page: Page): Promise<void> {
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await waitForFlowchartFixtureRender(page);
  await page.locator('.react-flow__edge-path').first().waitFor({ state: 'attached', timeout: 15_000 });
  await assertNoProductShadows(page, {
    edge: '.react-flow__edge-path',
    node: '.mermaid-flow-node',
  });
  const node = page.locator('.mermaid-flow-node').filter({ hasText: 'Browser' }).first();
  const colors = async () => page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>('[data-testid="diagram-canvas"]');
    const unselectedNode = [...document.querySelectorAll<HTMLElement>('.mermaid-flow-node')]
      .find((candidate) => !candidate.classList.contains('is-selected'));
    const unselectedSurface = unselectedNode?.querySelector<HTMLElement>('.mermaid-flow-node-surface');
    const edge = document.querySelector<SVGPathElement>('.react-flow__edge:not(.selected) .react-flow__edge-path');
    if (!canvas || !unselectedNode || !unselectedSurface || !edge) {
      throw new Error(`Neutral fallback audit requires an unselected node, edge, and canvas: ${JSON.stringify({
        canvas: !!canvas,
        edgeCount: document.querySelectorAll('.react-flow__edge').length,
        nodes: [...document.querySelectorAll<HTMLElement>('.mermaid-flow-node')].map((candidate) => candidate.className),
        unselectedEdgeCount: document.querySelectorAll('.react-flow__edge:not(.selected) .react-flow__edge-path').length,
      })}`);
    }
    const markerReference = edge.getAttribute('marker-end') ?? '';
    if (!markerReference.includes('color=var(--diagram-item-stroke-fallback)')) {
      throw new Error(`Default edge arrow does not use the shared fallback token: ${markerReference}.`);
    }
    const probe = document.createElement('span');
    probe.style.color = 'var(--diagram-item-stroke-fallback)';
    canvas.append(probe);
    const markerColor = getComputedStyle(probe).color;
    probe.remove();
    return {
      arrow: markerColor,
      background: getComputedStyle(unselectedSurface).backgroundColor,
      border: getComputedStyle(unselectedSurface).borderTopColor,
      canvas: getComputedStyle(canvas).backgroundColor,
      edge: getComputedStyle(edge).stroke,
      text: getComputedStyle(unselectedSurface).color,
    };
  });
  const assertFallbacks = (theme: string, value: Awaited<ReturnType<typeof colors>>) => {
    assertNeutralColor(value.background, `${theme} unselected node fill`);
    assertNeutralColor(value.border, `${theme} unselected node border`);
    assertNeutralColor(value.text, `${theme} unselected node text`);
    assertNeutralColor(value.edge, `${theme} unselected edge stroke`);
    assertNeutralColor(value.arrow, `${theme} unselected arrow fallback`);
    assertContrastAtLeast(value.border, value.canvas, 3, `${theme} unselected node border`);
    assertContrastAtLeast(value.edge, value.canvas, 3, `${theme} unselected edge stroke`);
    assertContrastAtLeast(value.arrow, value.canvas, 3, `${theme} unselected arrow fallback`);
  };
  const light = await colors();
  assertFallbacks('Light', light);
  await selectThemePreference(page, 'dark');
  const dark = await colors();
  assertFallbacks('Dark', dark);
  assert(light.background !== dark.background && light.text !== dark.text, `Unstyled nodes did not adopt theme-neutral colors: light=${JSON.stringify(light)} dark=${JSON.stringify(dark)}.`);
  await selectThemePreference(page, 'light');
}

async function expectContrastRoles(page: Page): Promise<void> {
  const roleColors = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      canvas: root.getPropertyValue('--surface-canvas').trim(),
      focus: root.getPropertyValue('--focus-ring').trim(),
      interactive: root.getPropertyValue('--interactive-hover').trim(),
      surface: root.getPropertyValue('--control-surface').trim(),
    };
  });
  assertContrastAtLeast(roleColors.focus, roleColors.canvas, 3, 'Focus role');
  assertContrastAtLeast(roleColors.interactive, roleColors.surface, 3, 'Interactive role');
  await ensureFlyout(page, 'activity');
  await verifiedClick(page, page.getByTestId('activity-flyout').getByRole('button', { name: /^Activity\s+/u }), 'activity view switch for contrast audit');
  const activityColors = await page.locator('.activity-time').first().evaluate((element) => {
    const background = element.closest('.activity-item-content');
    return { background: background ? getComputedStyle(background).backgroundColor : '', text: getComputedStyle(element).color };
  });
  assertContrastAtLeast(activityColors.text, activityColors.background, 4.5, 'Activity small text');
  await closeFlyout(page, 'activity');
}

async function expectActivityFlyoutFitSafety(page: Page): Promise<void> {
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await waitForFlowchartFixtureRender(page);
  await closeFlyout(page, 'source');
  const firstNode = page.locator('.mermaid-flow-node').first();
  await verifiedClick(page, firstNode, 'selected node before activity Fit');
  await page.getByTestId('canvas-node-toolbar').waitFor({ state: 'visible', timeout: 15_000 });
  const before = await snapshotAnchors(page, ANCHORS);
  await ensureFlyout(page, 'activity');
  await page.getByTestId('canvas-node-toolbar').waitFor({ state: 'detached', timeout: 15_000 });
  assert((await canonicalSelectedNodeIds(page)).length === 0,
    'Opening activity did not apply the workspace click-away deselection contract.');
  await verifiedClick(page, page.getByRole('button', { name: 'Fit diagram', exact: true }), 'Fit diagram while activity flyout is open');
  const after = await snapshotAnchors(page, ANCHORS);
  assertAnchorsStable(before, after);
  const flyout = await page.getByTestId('activity-flyout').boundingBox();
  const canvas = await page.getByTestId('diagram-canvas').boundingBox();
  assert(flyout && canvas, 'Activity Fit safety requires canvas and activity flyout bounds.');
  const canvasRect = { bottom: canvas.y + canvas.height, left: canvas.x, right: canvas.x + canvas.width, top: canvas.y };
  const flyoutRect = { bottom: flyout.y + flyout.height, left: flyout.x, right: flyout.x + flyout.width, top: flyout.y };
  for (const [label, locator, margin] of [
    ['graph node', page.locator('.mermaid-flow-node'), SAFE_FLYOUT_MARGIN],
    ['canvas controls', page.getByTestId('canvas-controls-toolbar'), 12],
  ] as const) {
    const safeRight = Math.min(canvasRect.right, flyoutRect.left - margin);
    const boxes = await locator.evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top };
    }));
    assert(boxes.length > 0, `Activity Fit did not render ${label}.`);
    for (const box of boxes) {
      assert(box.left >= canvasRect.left + margin && box.right <= safeRight
        && box.top >= canvasRect.top + margin && box.bottom <= canvasRect.bottom - margin,
      `${label} is outside unobscured activity-safe canvas: ${JSON.stringify({ box, canvas: canvasRect, flyout: flyoutRect, safeRight })}.`);
    }
  }
  await closeFlyout(page, 'activity');
}

async function expectNoDevelopmentIndicator(page: Page): Promise<void> {
  const hasIndicator = await page.evaluate(() => !!document.querySelector('nextjs-portal, [data-nextjs-dev-tools], [data-nextjs-toast]'));
  assert(!hasIndicator, 'Browser evidence is running with a Next.js development indicator; use the production owned-services mode for screenshots.');
}

async function prepareSettingsTargetForTouch(
  page: Page,
  target: Locator,
  label: string,
): Promise<void> {
  await target.waitFor({ state: 'visible', timeout: 15_000 });
  await target.scrollIntoViewIfNeeded();
  await target.evaluate((element) => {
    const dialog = element.closest('[data-testid="workspace-settings-dialog"]');
    if (!(dialog instanceof HTMLElement)) return;
    const dialogBounds = dialog.getBoundingClientRect();
    const targetBounds = element.getBoundingClientRect();
    dialog.scrollTop += targetBounds.top - dialogBounds.top
      - ((dialog.clientHeight - targetBounds.height) / 2);
  });
  await expect.poll(async () => target.evaluate((element) => {
    const dialog = element.closest('[data-testid="workspace-settings-dialog"]');
    if (!(dialog instanceof HTMLElement)) {
      return { centerHit: false, contained: false, hit: 'missing settings dialog' };
    }
    const dialogBounds = dialog.getBoundingClientRect();
    const targetBounds = element.getBoundingClientRect();
    const centerX = targetBounds.left + (targetBounds.width / 2);
    const centerY = targetBounds.top + (targetBounds.height / 2);
    const hit = document.elementFromPoint(centerX, centerY);
    const contained = targetBounds.top >= dialogBounds.top - 0.5
      && targetBounds.bottom <= dialogBounds.bottom + 0.5
      && targetBounds.left >= dialogBounds.left - 0.5
      && targetBounds.right <= dialogBounds.right + 0.5;
    return {
      centerHit: hit instanceof Node && element.contains(hit),
      contained,
      dialog: { bottom: dialogBounds.bottom, left: dialogBounds.left, right: dialogBounds.right, top: dialogBounds.top },
      hit: hit instanceof Element
        ? `${hit.tagName.toLowerCase()}[data-testid=${hit.getAttribute('data-testid') ?? ''}][class=${hit.getAttribute('class') ?? ''}]`
        : 'none',
      target: { bottom: targetBounds.bottom, left: targetBounds.left, right: targetBounds.right, top: targetBounds.top },
    };
  }), {
    message: `${label} did not settle fully inside the scrollable settings dialog with an unobscured center hit.`,
    timeout: 5_000,
  }).toMatchObject({ centerHit: true, contained: true });
  await assertContainedInViewport(page, target, label);
  await assertHitTarget(page, target, label);
}

async function assertStickySettingsHeading(
  page: Page,
  settings: Locator,
  close: Locator,
  label: string,
): Promise<void> {
  const heading = settings.locator('.workspace-settings-heading');
  await expect.poll(async () => heading.evaluate((element) => {
    const dialog = element.closest('[data-testid="workspace-settings-dialog"]');
    const closeButton = element.querySelector('.workspace-settings-close');
    if (!(dialog instanceof HTMLElement) || !(closeButton instanceof HTMLElement)) {
      return {
        closeCenterHit: false,
        closeContained: false,
        headingCenterHit: false,
        headingContained: false,
        hit: 'missing settings heading ancestors',
      };
    }
    const dialogBounds = dialog.getBoundingClientRect();
    const headingBounds = element.getBoundingClientRect();
    const closeBounds = closeButton.getBoundingClientRect();
    const headingHit = document.elementFromPoint(
      headingBounds.left + (headingBounds.width / 2),
      headingBounds.top + (headingBounds.height / 2),
    );
    const closeHit = document.elementFromPoint(
      closeBounds.left + (closeBounds.width / 2),
      closeBounds.top + (closeBounds.height / 2),
    );
    const headingContained = headingBounds.top >= dialogBounds.top - 0.5
      && headingBounds.bottom <= dialogBounds.bottom + 0.5
      && headingBounds.left >= dialogBounds.left - 0.5
      && headingBounds.right <= dialogBounds.right + 0.5;
    const closeContained = closeBounds.top >= dialogBounds.top - 0.5
      && closeBounds.bottom <= dialogBounds.bottom + 0.5
      && closeBounds.left >= dialogBounds.left - 0.5
      && closeBounds.right <= dialogBounds.right + 0.5;
    return {
      close: { bottom: closeBounds.bottom, left: closeBounds.left, right: closeBounds.right, top: closeBounds.top },
      closeCenterHit: closeHit instanceof Node && closeButton.contains(closeHit),
      closeContained,
      closeHit: closeHit instanceof Element
        ? `${closeHit.tagName.toLowerCase()}[class=${closeHit.getAttribute('class') ?? ''}]`
        : 'none',
      dialog: { bottom: dialogBounds.bottom, left: dialogBounds.left, right: dialogBounds.right, top: dialogBounds.top },
      heading: { bottom: headingBounds.bottom, left: headingBounds.left, right: headingBounds.right, top: headingBounds.top },
      headingCenterHit: headingHit instanceof Node && element.contains(headingHit),
      headingContained,
      headingHit: headingHit instanceof Element
        ? `${headingHit.tagName.toLowerCase()}[class=${headingHit.getAttribute('class') ?? ''}]`
        : 'none',
    };
  }), {
    message: `${label} did not keep the Settings heading and Close action sticky and unobscured.`,
    timeout: 5_000,
  }).toMatchObject({
    closeCenterHit: true,
    closeContained: true,
    headingCenterHit: true,
    headingContained: true,
  });
  await assertContainedInViewport(page, heading, `${label} heading`);
  await assertHitTarget(page, heading, `${label} heading`);
  await assertContainedInViewport(page, close, `${label} Close`);
  await assertHitTarget(page, close, `${label} Close`);
}

async function expectResponsiveControls(page: Page, label: string, diagramName: string): Promise<void> {
  await page.getByTestId('canvas-first-workspace').waitFor({ state: 'visible', timeout: 15_000 });
  await selectTabByName(page, diagramName);
  await waitForCanvas(page, 'flowchart');
  const sourceToggle = page.getByTestId('source-flyout-toggle');
  await expect(sourceToggle).toHaveAccessibleName(/^(show|hide) source$/i);
  assert(await sourceToggle.getAttribute('title') === 'Mermaid source',
    `${label} source toggle must retain its tooltip when text is hidden.`);
  await assertHitTarget(page, sourceToggle, `${label} source toggle`);
  if (label.startsWith('mobile')) {
    const sourceBounds = await sourceToggle.boundingBox();
    assert(sourceBounds !== null && sourceBounds.width >= 44 && sourceBounds.height >= 44,
      `${label} source toggle must provide a 44px touch target: ${JSON.stringify(sourceBounds)}.`);
    const shortcutHints = page.locator('.canvas-toolbar-shortcut');
    assert(await shortcutHints.count() > 0, `${label} did not render any desktop shortcut hints to suppress.`);
    const visibleShortcutHints = await shortcutHints.evaluateAll((hints) => hints.filter((hint) => getComputedStyle(hint).display !== 'none').length);
    assert(visibleShortcutHints === 0, `${label} exposed ${visibleShortcutHints} canvas shortcut hint(s) on a coarse-pointer viewport.`);
    await verifiedClick(page, sourceToggle, `${label} source flyout resize handle`);
    await page.getByTestId('source-flyout').waitFor({ state: 'visible', timeout: 15_000 });
    const sourceResizeHandle = page.getByTestId('source-flyout-resize-handle');
    assert(await sourceResizeHandle.evaluate((element) => getComputedStyle(element).display === 'none'),
      `${label} exposed a desktop source resize handle on a mobile or coarse-pointer layout.`);
    await verifiedClick(page, page.getByLabel('Close source panel', { exact: true }), `${label} close source resize check`);
    await page.getByTestId('source-flyout').waitFor({ state: 'detached', timeout: 15_000 });
  }
  if (label === 'mobile-320') {
    const topbarOverflow = page.getByTestId('topbar-collaborator-overflow');
    const footerOverflow = page.getByTestId('footer-collaborator-overflow');
    await expect.poll(async () => Number((await topbarOverflow.textContent())?.slice(1) ?? '0'), {
      message: 'mobile-320 did not expose an overflow indicator for four or more topbar collaborators.',
      timeout: 15_000,
    }).toBeGreaterThan(0);
    await expect.poll(async () => Number((await footerOverflow.textContent())?.slice(1) ?? '0'), {
      message: 'mobile-320 did not expose an overflow indicator for four or more footer collaborators.',
      timeout: 15_000,
    }).toBeGreaterThan(0);
    for (const [target, targetLabel] of [
      [topbarOverflow, 'topbar collaborator overflow'],
      [footerOverflow, 'footer collaborator overflow'],
    ] as const) {
      await target.waitFor({ state: 'visible', timeout: 15_000 });
      assert(/^\d+ more collaborators$/u.test(await target.getAttribute('aria-label') ?? ''),
        `${label} ${targetLabel} must expose its hidden collaborator count to assistive technology.`);
    }
  }
  const settingsTrigger = page.getByTestId(SETTINGS_TRIGGER_TEST_ID);
  await assertHitTarget(page, settingsTrigger, `${label} workspace settings trigger`);
  await assertContainedInViewport(page, settingsTrigger, `${label} workspace settings trigger`);
  if (label.startsWith('mobile')) {
    const settingsBounds = await settingsTrigger.boundingBox();
    assert(settingsBounds !== null && settingsBounds.width >= 44 && settingsBounds.height >= 44,
      `${label} workspace settings trigger must provide a 44px touch target: ${JSON.stringify(settingsBounds)}.`);
  }
  const settings = await openWorkspaceSettings(page);
  await assertContainedInViewport(page, settings, `${label} workspace settings dialog`);
  if (label.startsWith('mobile')) {
    const closeSettings = settings.getByRole('button', { name: 'Close', exact: true });
    await assertStickySettingsHeading(page, settings, closeSettings, `${label} settings initial state`);
    const closeBounds = await closeSettings.boundingBox();
    assert(closeBounds !== null && closeBounds.height >= 44,
      `${label} close settings must provide a 44px touch target: ${JSON.stringify(closeBounds)}.`);
    for (const [target, targetLabel] of [
      [settings.getByRole('button', { name: 'Cancel', exact: true }), 'cancel display-name edit'],
      [settings.getByRole('button', { name: 'Save name', exact: true }), 'save display name'],
      [settings.getByRole('button', { name: /^(Connect my agent|Connection details)$/u }), 'agent connection'],
      [settings.getByRole('textbox', { name: 'Display name', exact: true }), 'display-name input'],
      [settings.locator('.workspace-settings-theme-option').first(), 'System theme option'],
      [settings.locator('.workspace-settings-theme-option').nth(1), 'Light theme option'],
      [settings.locator('.workspace-settings-theme-option').nth(2), 'Dark theme option'],
    ] as const) {
      await prepareSettingsTargetForTouch(page, target, `${label} ${targetLabel}`);
      await assertStickySettingsHeading(page, settings, closeSettings, `${label} after scrolling to ${targetLabel}`);
      const bounds = await target.boundingBox();
      assert(bounds !== null && bounds.height >= 44,
        `${label} ${targetLabel} must provide a 44px touch target: ${JSON.stringify(bounds)}.`);
    }
  }
  await saveScreenshot(page, `issue-28-${label}-settings`);
  await closeWorkspaceSettings(page);
  await verifiedClick(page, sourceToggle, `${label} source toggle`);
  await page.getByTestId('source-flyout').waitFor({ state: 'visible', timeout: 15_000 });
  await verifiedClick(page, page.getByLabel('Close source panel', { exact: true }), `${label} close source`);
  await page.getByTestId('source-flyout').waitFor({ state: 'detached', timeout: 15_000 });
  const templateTrigger = page.getByTestId('create-diagram-tab');
  await assertHitTarget(page, templateTrigger, `${label} template creation control`);
  const templateMenu = await openTemplateMenu(page);
  const blankTemplate = templateMenuItem(page, 'Blank sheet');
  await waitForFocusedLocator(page, blankTemplate, `${label} opening starter template menu`);
  await assertDocumentHasNoHorizontalOverflow(page);
  await assertContainedInViewport(page, templateTrigger, `${label} template creation control`);
  await assertContainedInViewport(page, templateMenu, `${label} starter template menu`);
  await blankTemplate.press('Escape');
  await templateMenu.waitFor({ state: 'detached', timeout: 15_000 });
  if (label === 'mobile-320') {
    await assertDocumentHasNoHorizontalOverflow(page);
    for (const [target, targetLabel] of [
      [templateTrigger, 'tab creation control'],
      [settingsTrigger, 'workspace settings trigger'],
      [sourceToggle, 'source toggle'],
      [page.getByTestId('canvas-add-node-toolbar'), 'add-node toolbar'],
      [page.getByTestId('canvas-controls-toolbar'), 'canvas controls toolbar'],
    ] as const) {
      await assertContainedInViewport(page, target, `mobile-320 ${targetLabel}`);
    }
    const beforeZoomOut = await renderedCanvasTransform(page, 'mobile-320 zoom-out verification');
    await verifiedClick(page, page.getByRole('button', { name: 'Zoom out', exact: true }), 'mobile-320 Zoom out');
    await page.waitForFunction((previous) => document.querySelector('.diagram-canvas-svg')?.parentElement?.getAttribute('style') !== previous, beforeZoomOut, { timeout: 5_000 });
    const beforeZoomIn = await renderedCanvasTransform(page, 'mobile-320 zoom-in verification');
    await verifiedClick(page, page.getByRole('button', { name: 'Zoom in', exact: true }), 'mobile-320 Zoom in');
    await page.waitForFunction((previous) => document.querySelector('.diagram-canvas-svg')?.parentElement?.getAttribute('style') !== previous, beforeZoomIn, { timeout: 5_000 });
    const beforeFit = await renderedCanvasTransform(page, 'mobile-320 fit verification');
    await verifiedClick(page, page.getByRole('button', { name: 'Fit diagram', exact: true }), 'mobile-320 Fit diagram');
    await page.waitForFunction((previous) => document.querySelector('.diagram-canvas-svg')?.parentElement?.getAttribute('style') !== previous, beforeFit, { timeout: 5_000 });
    const mobileLabel = page.getByRole('textbox', { name: 'New node label', exact: true });
    await mobileLabel.fill('Mobile toolbar node');
    await verifiedClick(page, page.getByRole('button', { name: 'Add node to Mermaid text', exact: true }), 'mobile-320 add node');
    await ensureSourceFlyoutOpen(page);
    await page.waitForFunction(() => [...document.querySelectorAll('.cm-line')].some((line) => line.textContent?.includes('Mobile toolbar node')), undefined, { timeout: 15_000 });
    await closeFlyout(page, 'source');
  }
}

const PHONE_CONTEXT_OPTIONS = { deviceScaleFactor: 1, hasTouch: true, isMobile: true } as const;

async function waitForPhoneLayout(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });
  });
}

async function assertPhoneViewportEvidence(page: Page, label: string, state: string): Promise<void> {
  await waitForPhoneLayout(page);
  await assertDocumentMatchesViewport(page, `${label} ${state}`);
  const configuredViewport = page.viewportSize();
  assert(configuredViewport, `${label} ${state} has no configured browser viewport.`);
  const layout = await page.evaluate(() => ({
    devicePixelRatio: window.devicePixelRatio,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
  }));
  assert(layout.devicePixelRatio === 1,
    `${label} ${state} must capture at deviceScaleFactor 1, received ${layout.devicePixelRatio}.`);
  assert(layout.innerWidth === configuredViewport.width && layout.innerHeight === configuredViewport.height,
    `${label} ${state} CSS viewport ${layout.innerWidth}x${layout.innerHeight} did not match configured ${configuredViewport.width}x${configuredViewport.height}.`);
  const screenshot = await saveViewportScreenshot(page, `issue-18-${label}-${state}`);
  assert(screenshot.width === configuredViewport.width && screenshot.height === configuredViewport.height,
    `${label} ${state} screenshot was ${screenshot.width}x${screenshot.height}, expected ${configuredViewport.width}x${configuredViewport.height} at deviceScaleFactor 1.`);
}

async function assertVisiblePhoneActionTargets(page: Page, label: string, state: string): Promise<void> {
  const targets = page.locator('button, [role="tab"]');
  const viewport = page.viewportSize();
  assert(viewport, `${label} ${state} has no configured browser viewport.`);
  const count = await targets.count();
  let checked = 0;
  for (let index = 0; index < count; index += 1) {
    const target = targets.nth(index);
    if (!await target.isVisible()) continue;
    const box = await target.boundingBox();
    if (!box) continue;
    const centerVisible = box.x + (box.width / 2) >= 0
      && box.x + (box.width / 2) <= viewport.width
      && box.y + (box.height / 2) >= 0
      && box.y + (box.height / 2) <= viewport.height;
    if (!centerVisible) continue;
    const name = (await target.getAttribute('aria-label')) ?? (await target.textContent())?.trim() ?? `action ${index + 1}`;
    const centerResult = await target.evaluate((element, point) => {
      const hit = document.elementFromPoint(point.x, point.y);
      const targetHit = !!hit && (element === hit || element.contains(hit));
      let ancestor = element.parentElement;
      let clippedByScrollContainer = false;
      while (ancestor && !clippedByScrollContainer) {
        const style = window.getComputedStyle(ancestor);
        const clipsX = style.overflowX === 'auto' || style.overflowX === 'scroll';
        const clipsY = style.overflowY === 'auto' || style.overflowY === 'scroll';
        if (clipsX || clipsY) {
          const rect = ancestor.getBoundingClientRect();
          clippedByScrollContainer = (clipsX && (point.x < rect.left || point.x > rect.right))
            || (clipsY && (point.y < rect.top || point.y > rect.bottom));
        }
        ancestor = ancestor.parentElement;
      }
      const activeSurfaceSelectors = [
        '[data-testid="source-flyout"]',
        '[data-testid="activity-flyout"]',
        '[data-testid="workspace-settings-dialog"]',
        '[role="menu"][aria-label="Starter templates"]',
      ];
      const occludedByActiveSurface = !targetHit && !!hit && activeSurfaceSelectors.some((selector) => {
        const surface = document.querySelector(selector);
        return surface !== null && surface.contains(hit) && !surface.contains(element);
      });
      return {
        clippedByScrollContainer,
        hitDescription: hit instanceof Element
          ? `${hit.tagName.toLowerCase()}[data-testid=${hit.getAttribute('data-testid') ?? ''}][class=${hit.getAttribute('class') ?? ''}]`
          : 'none',
        occludedByActiveSurface,
        targetHit,
      };
    }, { x: box.x + (box.width / 2), y: box.y + (box.height / 2) });
    if (centerResult.clippedByScrollContainer) continue;
    if (centerResult.occludedByActiveSurface) continue;
    assert(centerResult.targetHit, `${label} ${state} ${name} is visible and centered in the viewport, but its center is hit by ${centerResult.hitDescription}.`);
    await assertTouchTarget(page, target, `${label} ${state} ${name}`);
    checked += 1;
  }
  assert(checked > 0, `${label} ${state} did not expose any visible action chrome.`);
}

async function assertPhoneSurface(page: Page, label: string, state: string): Promise<void> {
  await assertVisiblePhoneActionTargets(page, label, state);
  await assertPhoneViewportEvidence(page, label, state);
}

async function assertActiveTabVisible(page: Page, label: string): Promise<void> {
  const activeTab = page.locator('[role="tab"][aria-selected="true"]');
  await activeTab.waitFor({ state: 'visible', timeout: 15_000 });
  let geometry: { scrollerLeft: number; scrollerRight: number; tabLeft: number; tabRight: number } | null = null;
  try {
    await expect.poll(async () => {
      geometry = await activeTab.evaluate((tab) => {
        const scroller = tab.closest('[data-testid="diagram-tab-bar"]')?.querySelector('.workspace-diagram-tab-scroller');
        if (!(scroller instanceof HTMLElement)) {
          throw new Error('The active diagram tab has no scroll container.');
        }
        const tabContainer = tab.closest('.workspace-diagram-tab');
        if (!(tabContainer instanceof HTMLElement)) {
          throw new Error('The active diagram tab has no action container.');
        }
        const tabRect = tabContainer.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        return {
          scrollerLeft: scrollerRect.left,
          scrollerRight: scrollerRect.right,
          tabLeft: tabRect.left,
          tabRight: tabRect.right,
        };
      });
      return geometry.tabLeft >= geometry.scrollerLeft - 1 && geometry.tabRight <= geometry.scrollerRight + 1;
    }, { timeout: 5_000 }).toBe(true);
  } catch (error) {
    throw new Error(`${label} active tab or its actions remained clipped in the overflow scroller: ${JSON.stringify(geometry)}.`, { cause: error });
  }
}

async function tapTarget(page: Page, target: Locator, label: string): Promise<void> {
  await assertTouchTarget(page, target, label);
  const box = await target.boundingBox();
  assert(box, `${label} has no tappable bounds.`);
  const touchLabelStatus = page.getByTestId('workspace-touch-label-status');
  await touchLabelStatus.evaluate((element) => {
    element.setAttribute('data-e2e-live-region-identity', 'stable');
  });
  await page.touchscreen.tap(box.x + (box.width / 2), box.y + (box.height / 2));
  await expect(touchLabelStatus, `${label} remounted the persistent touch-label live region.`)
    .toHaveAttribute('data-e2e-live-region-identity', 'stable');
  await touchLabelStatus.evaluate((element) => {
    element.removeAttribute('data-e2e-live-region-identity');
  });
}

async function expectTouchLabelStatus(page: Page, expected: string, label: string): Promise<void> {
  const status = page.getByTestId('workspace-touch-label-status');
  await expect(status, `${label} did not preserve its touch label outside the action subtree.`).toHaveText(expected);
  await expect(status, `${label} touch label was not visibly presented.`).toHaveClass(/\bis-visible\b/u);
  await assertContainedInViewport(page, status, `${label} touch label`);
  const overflowStyle = await status.evaluate((element) => {
    const style = getComputedStyle(element);
    return { overflow: style.overflow, textOverflow: style.textOverflow, whiteSpace: style.whiteSpace };
  });
  assert(overflowStyle.overflow === 'hidden' && overflowStyle.textOverflow === 'ellipsis' && overflowStyle.whiteSpace === 'nowrap',
    `${label} touch label cannot safely truncate a long status: ${JSON.stringify(overflowStyle)}.`);
  await expect(page.locator('.workspace-touch-label[data-touch-label-visible="true"]'),
    `${label} retained a duplicate anchored touch label after pointer release.`).toHaveCount(0);
}

async function waitForTouchLabelPresentationToClear(page: Page, label: string): Promise<void> {
  const status = page.getByTestId('workspace-touch-label-status');
  await expect(status, `${label} persistent touch label did not clear.`).toHaveText('', { timeout: 3_000 });
  await expect(status, `${label} persistent touch label remained visible.`).not.toHaveClass(/\bis-visible\b/u);
  await expect(page.locator('.workspace-touch-label[data-touch-label-visible="true"]'),
    `${label} retained an anchored touch label.`).toHaveCount(0);
}

async function assertMobileErrorBannerScrollability(page: Page, label: string): Promise<void> {
  const banner = page.getByTestId('parse-error-banner');
  await banner.waitFor({ state: 'visible', timeout: 15_000 });
  const behavior = await banner.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      maxHeight: style.maxHeight,
      overflowY: style.overflowY,
      pointerEvents: style.pointerEvents,
      touchAction: style.touchAction,
    };
  });
  assert(behavior.maxHeight !== 'none' && (behavior.overflowY === 'auto' || behavior.overflowY === 'scroll')
    && behavior.pointerEvents === 'auto' && behavior.touchAction === 'pan-y',
  `${label} global Mermaid error is not capped and touch-scrollable: ${JSON.stringify(behavior)}.`);
  const canvasReceivesTouchesOutsideBanner = await page.evaluate(() => {
    const bannerElement = document.querySelector<HTMLElement>('[data-testid="parse-error-banner"]');
    const canvas = document.querySelector<HTMLElement>('[data-testid="diagram-canvas"]');
    if (!bannerElement || !canvas) return false;
    const bannerBounds = bannerElement.getBoundingClientRect();
    const canvasBounds = canvas.getBoundingClientRect();
    const ratios = [0.1, 0.5, 0.9];
    for (const yRatio of ratios) {
      for (const xRatio of ratios) {
        const x = canvasBounds.left + (canvasBounds.width * xRatio);
        const y = canvasBounds.top + (canvasBounds.height * yRatio);
        const insideBanner = x >= bannerBounds.left && x <= bannerBounds.right
          && y >= bannerBounds.top && y <= bannerBounds.bottom;
        const hit = document.elementFromPoint(x, y);
        if (!insideBanner && hit instanceof Node && canvas.contains(hit)) return true;
      }
    }
    return false;
  });
  assert(canvasReceivesTouchesOutsideBanner,
    `${label} global Mermaid error prevented the canvas receiving pointer hits outside the banner bounds.`);
}

async function waitForCameraChange(page: Page, previous: string, label: string): Promise<string> {
  let current = previous;
  try {
    await expect.poll(async () => {
      current = await renderedCanvasCameraTransform(page, `${label} camera poll`);
      return current !== previous;
    }, {
      message: `${label} camera did not change from ${JSON.stringify(previous)}.`,
      timeout: 5_000,
    }).toBe(true);
  } catch (error) {
    throw new Error(
      `${label} camera did not change within 5000ms: previous=${JSON.stringify(previous)}, current=${JSON.stringify(current)}.`,
      { cause: error },
    );
  }
  return current;
}

type CanvasGesturePoint = { x: number; y: number };

async function allowedCanvasGesturePoints(
  page: Page,
  label: string,
  count: number,
  minimumSeparationPx: number,
): Promise<CanvasGesturePoint[]> {
  const points = await page.getByTestId('diagram-canvas').evaluate((canvas, options) => {
    const root = canvas as HTMLElement;
    const rect = root.getBoundingClientRect();
    // Keep the test's blank-point contract aligned with DiagramCanvas: a drag
    // beginning on a sequence editor form is intentionally not a canvas pan.
    const forbiddenSelector = 'a, button, input, select, textarea, form, [contenteditable="true"], [role="button"], [data-canvas-pan-exclusion="true"], [data-subgraph-drag-target="true"], [data-testid*="toolbar"], .react-flow__node, .react-flow__edge, .react-flow__handle';
    const ratios = [0.12, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.88];
    const candidates: CanvasGesturePoint[] = [];

    for (const yRatio of ratios) {
      for (const xRatio of ratios) {
        const point = { x: rect.left + (rect.width * xRatio), y: rect.top + (rect.height * yRatio) };
        const target = document.elementFromPoint(point.x, point.y);
        if (!(target instanceof Element) || !root.contains(target) || target.closest(forbiddenSelector)) continue;
        if (candidates.every((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) >= options.minimumSeparationPx)) {
          candidates.push(point);
        }
        if (candidates.length === options.count) return candidates;
      }
    }
    return candidates;
  }, { count, minimumSeparationPx });
  assert(points.length === count,
    `${label} found ${points.length} of ${count} required blank canvas touch points at least ${minimumSeparationPx}px apart.`);
  return points;
}

async function dispatchTouchDrag(page: Page, label: string): Promise<void> {
  const [from, to] = await allowedCanvasGesturePoints(page, `${label} pan`, 2, 48);
  assert(from && to, `${label} pan did not resolve two blank canvas points.`);
  const session = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => ({ force: 1, id: 1, radiusX: 1, radiusY: 1, x, y });
  try {
    await session.send('Input.dispatchTouchEvent', { touchPoints: [point(from.x, from.y)], type: 'touchStart' });
    await session.send('Input.dispatchTouchEvent', { touchPoints: [point((from.x + to.x) / 2, (from.y + to.y) / 2)], type: 'touchMove' });
    await session.send('Input.dispatchTouchEvent', { touchPoints: [point(to.x, to.y)], type: 'touchMove' });
    await session.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
  } finally {
    await session.detach();
  }
}

function parseCameraTransform(transform: string, label: string): { panX: number; panY: number; zoom: number } {
  const match = transform.match(/^translate\(([-+]?(?:\d+(?:\.\d*)?|\.\d+))px,\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+))px\)\s*scale\(([-+]?(?:\d+(?:\.\d*)?|\.\d+))\)$/u);
  assert(match, `${label} has an unexpected canvas transform: ${transform}.`);
  const camera = { panX: Number(match[1]), panY: Number(match[2]), zoom: Number(match[3]) };
  assert(Object.values(camera).every(Number.isFinite), `${label} has non-finite camera values: ${transform}.`);
  return camera;
}

async function assertPinchZoomIncrease(page: Page, label: string, renderer: 'flowchart' | 'sequence' | 'generic', residuals: string[]): Promise<void> {
  const initial = await allowedCanvasGesturePoints(page, `${label} ${renderer} pinch`, 2, 72);
  const [first, second] = initial;
  assert(first && second, `${label} ${renderer} pinch did not resolve two blank canvas points.`);
  const beforeTransform = await renderedCanvasCameraTransform(page, `${label} ${renderer} pinch baseline`);
  const before = parseCameraTransform(beforeTransform, `${label} ${renderer} pinch baseline`);
  const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  const expansion = 1.35;
  const canvasBounds = await page.getByTestId('diagram-canvas').boundingBox();
  assert(canvasBounds, `${label} ${renderer} pinch has no canvas bounds.`);
  const inset = Math.min(8, canvasBounds.width / 4, canvasBounds.height / 4);
  const minX = canvasBounds.x + inset;
  const maxX = canvasBounds.x + canvasBounds.width - inset;
  const minY = canvasBounds.y + inset;
  const maxY = canvasBounds.y + canvasBounds.height - inset;
  const movedFirst = {
    x: Math.max(minX, Math.min(maxX, center.x + ((first.x - center.x) * expansion))),
    y: Math.max(minY, Math.min(maxY, center.y + ((first.y - center.y) * expansion))),
  };
  const movedSecond = {
    x: Math.max(minX, Math.min(maxX, center.x + ((second.x - center.x) * expansion))),
    y: Math.max(minY, Math.min(maxY, center.y + ((second.y - center.y) * expansion))),
  };
  const initialSeparation = Math.hypot(first.x - second.x, first.y - second.y);
  const movedSeparation = Math.hypot(movedFirst.x - movedSecond.x, movedFirst.y - movedSecond.y);
  for (const [pointLabel, gesturePoint] of [['first', movedFirst], ['second', movedSecond]] as const) {
    assert(gesturePoint.x >= minX && gesturePoint.x <= maxX && gesturePoint.y >= minY && gesturePoint.y <= maxY,
      `${label} ${renderer} clamped ${pointLabel} pinch point escaped the inset canvas bounds: ${JSON.stringify({ canvasBounds, gesturePoint, inset })}.`);
  }
  assert(movedSeparation > initialSeparation,
    `${label} ${renderer} clamped pinch did not expand touch separation: ${initialSeparation} -> ${movedSeparation}.`);
  const session = await page.context().newCDPSession(page);
  const point = (id: number, x: number, y: number) => ({ force: 1, id, radiusX: 1, radiusY: 1, x, y });
  try {
    await session.send('Input.dispatchTouchEvent', {
      touchPoints: [point(1, first.x, first.y), point(2, second.x, second.y)],
      type: 'touchStart',
    });
    await session.send('Input.dispatchTouchEvent', {
      touchPoints: [point(1, movedFirst.x, movedFirst.y), point(2, movedSecond.x, movedSecond.y)],
      type: 'touchMove',
    });
    await session.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
  } catch (error) {
    throw new Error(`${label} ${renderer} CDP pinch could not be dispatched.`, { cause: error });
  } finally {
    await session.detach();
  }
  let afterZoom = before.zoom;
  await expect.poll(async () => {
    const transform = await renderedCanvasCameraTransform(page, `${label} ${renderer} pinch result`);
    afterZoom = parseCameraTransform(transform, `${label} ${renderer} pinch result`).zoom;
    return afterZoom;
  }, {
    message: `${label} ${renderer} pinch did not increase zoom above ${before.zoom}.`,
    timeout: 5_000,
  }).toBeGreaterThan(before.zoom + 0.001);
  residuals.push(`${label} ${renderer}: simulated pinch increased zoom from ${before.zoom} to ${afterZoom}; physical iOS/Android pinch remains a manual residual.`);
}

async function expectTouchCanvasControls(
  page: Page,
  label: string,
  renderer: 'flowchart' | 'sequence' | 'generic',
  residuals: string[],
): Promise<void> {
  const controls = page.getByTestId('canvas-controls-toolbar');
  await controls.waitFor({ state: 'visible', timeout: 15_000 });
  for (const name of ['Zoom out', 'Zoom in', 'Fit diagram'] as const) {
    await assertTouchTarget(page, page.getByRole('button', { name, exact: true }), `${label} ${renderer} ${name}`);
  }
  if (renderer === 'flowchart') {
    const addNode = page.getByRole('button', { name: 'Add node to Mermaid text', exact: true });
    await assertTouchTarget(page, addNode, `${label} flowchart add-node control`);
    await addNode.click({ trial: true, timeout: 15_000 });
  }
  if (renderer === 'sequence') {
    const canvas = page.getByTestId('canvas-first-workspace');
    const participantForm = page.locator('form.canvas-sequence-participant-form');
    const messageForm = page.locator('form.canvas-sequence-message-form:has([aria-label="Sequence message"])');
    const participantAdd = page.getByRole('button', { name: 'Add sequence participant', exact: true });
    const messageAdd = page.getByRole('button', { name: 'Add sequence message', exact: true });
    await Promise.all([
      assertTouchTarget(page, participantAdd, `${label} sequence add participant`),
      assertTouchTarget(page, messageAdd, `${label} sequence add message`),
      assertContainedInViewport(page, participantForm, `${label} sequence participant form`),
      assertContainedInViewport(page, messageForm, `${label} sequence message form`),
    ]);
    await assertDocumentHasNoHorizontalOverflow(page);
    const layout = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLElement>('[data-testid="canvas-first-workspace"]');
      const forms = [...document.querySelectorAll<HTMLElement>('form.canvas-sequence-participant-form, form.canvas-sequence-message-form:has([aria-label="Sequence message"])')];
      if (!canvas || forms.length !== 2) return null;
      const canvasBounds = canvas.getBoundingClientRect();
      return forms.map((form) => {
        const bounds = form.getBoundingClientRect();
        return {
          bottom: bounds.bottom,
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          withinCanvas: bounds.top >= canvasBounds.top - 0.5
            && bounds.bottom <= canvasBounds.bottom + 0.5
            && bounds.left >= canvasBounds.left - 0.5
            && bounds.right <= canvasBounds.right + 0.5,
        };
      });
    });
    assert(layout !== null && layout.every((form) => form.withinCanvas),
      `${label} sequence forms overflowed or overlapped workspace chrome: ${JSON.stringify(layout)}.`);
    if (label === 'mobile-landscape') {
      const editor = page.getByTestId('sequence-editor-controls');
      const scrollSurface = page.locator('form.canvas-sequence-message-form:has([aria-label="Sequence message"])');
      const beforeScroll = await editor.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop }));
      assert(beforeScroll.scrollHeight > beforeScroll.clientHeight,
        `${label} sequence editor did not expose overflow for lower controls: ${JSON.stringify(beforeScroll)}.`);
      const bounds = await scrollSurface.boundingBox();
      assert(bounds, `${label} sequence editor has no visible touch-scroll form.`);
      const session = await page.context().newCDPSession(page);
      const touch = (y: number) => ({ force: 1, id: 1, radiusX: 1, radiusY: 1, x: bounds.x + (bounds.width / 2), y });
      try {
        const start = bounds.y + bounds.height - 24;
        await session.send('Input.dispatchTouchEvent', { touchPoints: [touch(start)], type: 'touchStart' });
        await session.send('Input.dispatchTouchEvent', { touchPoints: [touch(start - 48)], type: 'touchMove' });
        await session.send('Input.dispatchTouchEvent', { touchPoints: [touch(start - 112)], type: 'touchMove' });
        await session.send('Input.dispatchTouchEvent', { touchPoints: [touch(start - 176)], type: 'touchMove' });
        await session.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
      } finally {
        await session.detach();
      }
      await expect.poll(() => editor.evaluate((element) => element.scrollTop), {
        message: `${label} sequence editor did not respond to a vertical touch scroll.`,
        timeout: 5_000,
      }).toBeGreaterThan(beforeScroll.scrollTop);
      let previousScrollTop = await editor.evaluate((element) => element.scrollTop);
      let stableScrollSamples = 0;
      await expect.poll(async () => {
        const currentScrollTop = await editor.evaluate((element) => element.scrollTop);
        stableScrollSamples = Math.abs(currentScrollTop - previousScrollTop) < 0.5 ? stableScrollSamples + 1 : 0;
        previousScrollTop = currentScrollTop;
        return stableScrollSamples;
      }, {
        message: `${label} sequence editor scroll did not settle before canvas interaction.`,
        timeout: 5_000,
        intervals: [50],
      }).toBeGreaterThanOrEqual(3);
      const activation = page.getByRole('button', { name: 'Add sequence activation', exact: true });
      await activation.scrollIntoViewIfNeeded();
      await tapTarget(page, activation, `${label} sequence lower activation control`);
      await editor.evaluate((element) => { element.scrollTop = 0; });
    }
  }

  const beforeZoom = await renderedCanvasCameraTransform(page, `${label} ${renderer} touch zoom baseline`);
  await tapTarget(page, page.getByRole('button', { name: 'Zoom in', exact: true }), `${label} ${renderer} touch Zoom in`);
  const afterZoom = await waitForCameraChange(page, beforeZoom, `${label} ${renderer} touch zoom`);
  await tapTarget(page, page.getByRole('button', { name: 'Fit diagram', exact: true }), `${label} ${renderer} touch Fit diagram`);
  const afterFit = await waitForCameraChange(page, afterZoom, `${label} ${renderer} touch fit`);
  await dispatchTouchDrag(page, `${label} ${renderer}`);
  await waitForCameraChange(page, afterFit, `${label} ${renderer} touch pan`);
  await assertPinchZoomIncrease(page, label, renderer, residuals);
}

async function expectPhoneLiveCodingWorkspace(page: Page, label: string, diagramName: string, residuals: string[]): Promise<void> {
  await page.getByTestId('canvas-first-workspace').waitFor({ state: 'visible', timeout: 15_000 });
  await selectTabByName(page, diagramName);
  await waitForCanvas(page, 'flowchart');
  await assertActiveTabVisible(page, `${label} initial tabs`);
  await assertPhoneSurface(page, label, 'canvas');

  await expect.poll(async () => (await presenceSignature(page)).length, {
    message: `${label} did not show collaboration presence after peer pages joined.`,
    timeout: 15_000,
  }).toBeGreaterThanOrEqual(2);
  await assertPhoneSurface(page, label, 'presence-and-footer');

  const sourceCamera = await renderedCanvasCameraTransform(page, `${label} source baseline`);
  const sourceToggle = page.getByTestId('source-flyout-toggle');
  await tapTarget(page, sourceToggle, `${label} source toggle`);
  await page.getByTestId('source-flyout').waitFor({ state: 'visible', timeout: 15_000 });
  await expect(page.getByTestId('source-flyout')).toHaveCount(1);
  await expectTouchLabelStatus(page, 'Show source', `${label} source toggle`);
  assert(await renderedCanvasCameraTransform(page, `${label} source open`) === sourceCamera,
    `${label} opening source changed the local canvas camera.`);
  await assertPhoneSurface(page, label, 'source');
  const sourceClose = page.getByRole('button', { name: 'Close source panel', exact: true });
  await tapTarget(page, sourceClose, `${label} source close`);
  await page.getByTestId('source-flyout').waitFor({ state: 'detached', timeout: 15_000 });
  await expectTouchLabelStatus(page, 'Close', `${label} source close`);
  assert(await renderedCanvasCameraTransform(page, `${label} source close`) === sourceCamera,
    `${label} closing source changed the local canvas camera.`);

  const templateCamera = await renderedCanvasCameraTransform(page, `${label} template baseline`);
  const templateMenu = await openTemplateMenu(page);
  assert(await renderedCanvasCameraTransform(page, `${label} template open`) === templateCamera,
    `${label} opening templates changed the local canvas camera.`);
  await assertContainedInViewport(page, templateMenu, `${label} starter template menu`);
  const blankTemplate = templateMenuItem(page, 'Blank sheet');
  await assertTouchTarget(page, blankTemplate, `${label} Blank sheet template`);
  await blankTemplate.click({ trial: true, timeout: 15_000 });
  await assertPhoneSurface(page, label, 'templates');
  if (label === 'mobile-390') {
    const beforeTabCount = await page.getByRole('tab').count();
    await blankTemplate.click();
    await page.waitForFunction((count) => document.querySelectorAll('[role="tab"]').length === count + 1, beforeTabCount, { timeout: 15_000 });
    await assertActiveTabVisible(page, `${label} blank-sheet tab`);
    await assertPhoneSurface(page, label, 'tab-overflow');
    await renameActiveDiagram(page, 'Phone scratchpad');
    await assertActiveTabVisible(page, `${label} renamed tab`);
    const tabCountBeforeDelete = await page.getByRole('tab').count();
    const deleteTab = page.getByRole('button', { name: 'Delete Phone scratchpad', exact: true });
    await tapTarget(page, deleteTab, `${label} delete tab`);
    await page.waitForFunction((count) => document.querySelectorAll('[role="tab"]').length === count - 1, tabCountBeforeDelete, { timeout: 15_000 });
    await expect(page.getByRole('tab', { name: 'Phone scratchpad', exact: true })).toHaveCount(0);
    await expectTouchLabelStatus(page, 'Delete', `${label} delete tab`);
  } else {
    await waitForFocusedLocator(page, blankTemplate, `${label} opening starter templates`);
    await blankTemplate.press('Escape');
    await templateMenu.waitFor({ state: 'detached', timeout: 15_000 });
    await waitForFocusedTestId(page, 'create-diagram-tab', `${label} closing starter templates with Escape`);
  }

  await selectTabByName(page, diagramName);
  await waitForCanvas(page, 'flowchart');
  const settingsCamera = await renderedCanvasCameraTransform(page, `${label} settings baseline`);
  const settingsTrigger = page.getByTestId(SETTINGS_TRIGGER_TEST_ID);
  await tapTarget(page, settingsTrigger, `${label} settings`);
  await page.getByTestId(SETTINGS_DIALOG_TEST_ID).waitFor({ state: 'visible', timeout: 15_000 });
  await expect(page.getByTestId(SETTINGS_DIALOG_TEST_ID)).toHaveCount(1);
  await expectTouchLabelStatus(page, 'Settings', `${label} settings`);
  assert(await renderedCanvasCameraTransform(page, `${label} settings open`) === settingsCamera,
    `${label} opening settings changed the local canvas camera.`);
  await waitForTouchLabelPresentationToClear(page, `${label} settings screenshot`);
  await assertPhoneSurface(page, label, 'settings');
  await closeWorkspaceSettings(page);
  assert(await renderedCanvasCameraTransform(page, `${label} settings close`) === settingsCamera,
    `${label} closing settings changed the local canvas camera.`);

  const historyCamera = await renderedCanvasCameraTransform(page, `${label} history baseline`);
  await ensureFlyout(page, 'activity');
  assert(await renderedCanvasCameraTransform(page, `${label} history open`) === historyCamera,
    `${label} opening history changed the local canvas camera.`);
  await page.getByTestId('diagram-history-list').waitFor({ state: 'visible', timeout: 15_000 });
  await assertPhoneSurface(page, label, 'history');
  await closeFlyout(page, 'activity');
  assert(await renderedCanvasCameraTransform(page, `${label} history close`) === historyCamera,
    `${label} closing history changed the local canvas camera.`);

  await expectTouchCanvasControls(page, label, 'flowchart', residuals);
  await assertPhoneSurface(page, label, 'flowchart-touch-controls');

  await replaceSource(page, API_SEQUENCE_FIXTURE);
  await waitForSource(page, API_SEQUENCE_FIXTURE);
  await closeFlyout(page, 'source');
  await waitForCanvas(page, 'sequence');
  await expectTouchCanvasControls(page, label, 'sequence', residuals);
  await assertPhoneSurface(page, label, 'sequence-touch-controls');

  await replaceSource(page, INVALID_MERMAID_FIXTURE);
  await waitForInvalidPreview(page);
  const sourceFlyout = page.getByTestId('source-flyout');
  const sourceParseStatus = page.getByTestId('source-parse-status');
  await sourceParseStatus.waitFor({ state: 'visible', timeout: 15_000 });
  await expect(sourceParseStatus).toContainText('Preview kept on last valid diagram');
  await expect(sourceParseStatus.locator('span')).not.toHaveText('');
  await expect(page.getByTestId('parse-error-banner')).toHaveCount(0);
  await assertContainedInViewport(page, sourceFlyout, `${label} invalid Mermaid source flyout`);
  await assertContainedInViewport(page, sourceParseStatus, `${label} contextual source parse error`);
  await assertPhoneSurface(page, label, 'source-parse-error');

  await closeFlyout(page, 'source');
  await waitForInvalidPreview(page);
  await assertMobileErrorBannerScrollability(page, `${label} global Mermaid error`);

  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForSource(page, FLOWCHART_FIXTURE);
  await sourceParseStatus.waitFor({ state: 'detached', timeout: 15_000 });
  await closeFlyout(page, 'source');
  await waitForCanvas(page, 'flowchart');
  await assertPhoneSurface(page, label, 'flowchart-restored');
}

function historyItem(page: Page, revisionId: string): Locator {
  return page.getByTestId(`history-revision-${revisionId}`);
}

async function assertCurrentHistoryCardEdges(page: Page): Promise<void> {
  const current = page.locator('.history-item.is-current');
  await current.waitFor({ state: 'visible', timeout: 15_000 });
  await current.evaluate((element) => { element.scrollIntoView({ behavior: 'auto', block: 'center' }); });
  const edges = await current.evaluate((element) => {
    const marker = element.querySelector<HTMLElement>('.history-current-head');
    const style = getComputedStyle(element);
    return {
      bottom: { color: style.borderBottomColor, width: style.borderBottomWidth },
      left: { color: style.borderLeftColor, width: style.borderLeftWidth },
      markerColor: marker ? getComputedStyle(marker).color : null,
      right: { color: style.borderRightColor, width: style.borderRightWidth },
      top: { color: style.borderTopColor, width: style.borderTopWidth },
    };
  });
  assert(edges.markerColor !== null, 'Current history card did not render its current-head marker.');
  for (const [edge, value] of Object.entries({ bottom: edges.bottom, left: edges.left, right: edges.right, top: edges.top })) {
    assert(value.width === '1px' && value.color === edges.markerColor,
      `Current history card ${edge} edge lost its selection border: ${JSON.stringify(edges)}.`);
  }
}

async function prepareHistoryActionForClick(
  page: Page,
  item: Locator,
  action: Locator,
  label: string,
): Promise<void> {
  const list = page.getByTestId('diagram-history-list');
  await list.waitFor({ state: 'visible', timeout: 15_000 });
  await item.waitFor({ state: 'visible', timeout: 15_000 });
  await item.evaluate((element) => {
    element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
  });
  await action.scrollIntoViewIfNeeded();
  await expect.poll(async () => action.evaluate((element) => {
    const itemElement = element.closest('.history-item');
    const listElement = element.closest('.history-list');
    if (!(itemElement instanceof HTMLElement) || !(listElement instanceof HTMLElement)) {
      return { actionContained: false, centerHit: false, hit: 'missing history ancestors', itemContained: false };
    }
    const actionBounds = element.getBoundingClientRect();
    const itemBounds = itemElement.getBoundingClientRect();
    const listBounds = listElement.getBoundingClientRect();
    const centerX = actionBounds.left + (actionBounds.width / 2);
    const centerY = actionBounds.top + (actionBounds.height / 2);
    const hit = document.elementFromPoint(centerX, centerY);
    const actionContained = actionBounds.top >= listBounds.top - 0.5
      && actionBounds.bottom <= listBounds.bottom + 0.5
      && actionBounds.left >= listBounds.left - 0.5
      && actionBounds.right <= listBounds.right + 0.5;
    const itemContained = itemBounds.top >= listBounds.top - 0.5
      && itemBounds.bottom <= listBounds.bottom + 0.5
      && itemBounds.left >= listBounds.left - 0.5
      && itemBounds.right <= listBounds.right + 0.5;
    return {
      action: { bottom: actionBounds.bottom, left: actionBounds.left, right: actionBounds.right, top: actionBounds.top },
      actionContained,
      centerHit: hit instanceof Node && element.contains(hit),
      hit: hit instanceof Element
        ? `${hit.tagName.toLowerCase()}[data-testid=${hit.getAttribute('data-testid') ?? ''}][class=${hit.getAttribute('class') ?? ''}]`
        : 'none',
      item: { bottom: itemBounds.bottom, left: itemBounds.left, right: itemBounds.right, top: itemBounds.top },
      itemContained,
      list: { bottom: listBounds.bottom, left: listBounds.left, right: listBounds.right, top: listBounds.top },
    };
  }), {
    message: `${label} did not settle fully inside the history list with an unobscured center hit.`,
    timeout: 5_000,
  }).toMatchObject({ actionContained: true, centerHit: true, itemContained: true });
  await assertContainedInViewport(page, action, label);
  await assertHitTarget(page, action, label);
}

function snapshotsMatch(left: YjsSessionSnapshot, right: YjsSessionSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sourceAndLayoutMatch(
  snapshot: YjsSessionSnapshot,
  revision: Pick<DiagramRevision, 'mermaidText' | 'nodePositions'>,
): boolean {
  return snapshot.mermaidText === revision.mermaidText
    && JSON.stringify(snapshot.nodePositions) === JSON.stringify(revision.nodePositions);
}

async function waitForHistoryRevision(
  mcp: ModernMcpClient,
  sessionId: string,
  diagramId: string,
  source: string,
): Promise<{ history: { currentRevision: string; revisions: DiagramRevisionSummary[] }; revision: DiagramRevision }> {
  let match: { history: { currentRevision: string; revisions: DiagramRevisionSummary[] }; revision: DiagramRevision } | null = null;
  await expect.poll(async () => {
    const history = await mcp.listDiagramHistory(sessionId, diagramId);
    for (const summary of history.revisions) {
      const revision = await mcp.readDiagramRevision(sessionId, diagramId, summary.id);
      if (revision.mermaidText === source) {
        match = { history, revision };
        return true;
      }
    }
    return false;
  }, {
    message: `Immutable history did not capture the requested Mermaid source for ${diagramId}.`,
    timeout: 15_000,
  }).toBe(true);
  assert(match, `History search did not retain ${diagramId} even though its poll succeeded.`);
  return match;
}

async function renderedSelectedNodeIds(page: Page): Promise<string[]> {
  return page.locator('.react-flow__node.selected').evaluateAll((nodes) => nodes
    .map((node) => node.getAttribute('data-id'))
    .filter((id): id is string => Boolean(id))
    .sort());
}

async function canonicalSelectedNodeIds(page: Page): Promise<string[]> {
  const value = await page.getByTestId('diagram-canvas').getAttribute('data-selected-node-ids');
  assert(value !== null, 'Diagram canvas did not expose canonical selected-node state.');
  try {
    const selected = JSON.parse(value);
    assert(Array.isArray(selected) && selected.every((nodeId) => typeof nodeId === 'string'),
      `Diagram canvas exposed invalid canonical selected-node state: ${value}.`);
    return selected;
  } catch {
    throw new Error(`Diagram canvas exposed invalid canonical selected-node state: ${value}.`);
  }
}

async function presenceSignature(page: Page): Promise<string[]> {
  return page.getByTestId('presence-bar').locator('[title]').evaluateAll((avatars) => avatars
    .map((avatar) => avatar.getAttribute('title') ?? '')
    .filter(Boolean)
    .sort());
}

type LocalWorkspaceSnapshot = {
  activeTab: string;
  camera: string;
  presence: string[];
  selected: string[];
};

async function snapshotLocalWorkspace(page: Page, label: string): Promise<LocalWorkspaceSnapshot> {
  return {
    activeTab: await activeTabName(page),
    camera: await renderedCanvasCameraTransform(page, `${label} camera`),
    presence: await presenceSignature(page),
    selected: await canonicalSelectedNodeIds(page),
  };
}

async function selectAndZoomHistoryDiagram(page: Page, index: number, label: string): Promise<void> {
  const node = page.locator('.react-flow__node').nth(index);
  await verifiedClick(page, node, `${label} selected node`);
  const beforeZoom = await renderedCanvasTransform(page, `${label} before zoom`);
  await verifiedClick(page, page.getByRole('button', { name: 'Zoom in', exact: true }), `${label} zoom in`);
  await page.waitForFunction((previous) => document.querySelector('.diagram-canvas-svg')?.parentElement?.getAttribute('style') !== previous, beforeZoom, { timeout: 5_000 });
}

async function dragHistoryNode(page: Page, label: string, delta: { x: number; y: number }): Promise<string> {
  const node = page.locator('.react-flow__node').first();
  const nodeId = await node.getAttribute('data-id');
  assert(nodeId, `${label} drag fixture is missing a React Flow node ID.`);
  const box = await node.boundingBox();
  assert(box, `${label} drag fixture has no node bounds.`);
  await page.mouse.move(box.x + (box.width / 2), box.y + (box.height / 2));
  await page.mouse.down();
  await page.mouse.move(box.x + (box.width / 2) + delta.x, box.y + (box.height / 2) + delta.y, { steps: 8 });
  await page.mouse.up();
  return nodeId;
}

async function expectHistoryFlyoutSafety(
  page: Page,
  label: string,
  revisionId: string,
): Promise<void> {
  const before = await snapshotAnchors(page, ANCHORS);
  const beforeCamera = await waitForStableCanvasTransform(page, `${label} history camera`);
  const toggle = page.getByTestId('activity-flyout-toggle');
  await assertHitTarget(page, toggle, `${label} activity and history toggle`);
  await assertContainedInViewport(page, toggle, `${label} activity and history toggle`);
  await verifiedClick(page, toggle, `${label} activity and history toggle`);
  const flyout = page.getByTestId('activity-flyout');
  await flyout.waitFor({ state: 'visible', timeout: 15_000 });
  await assertContainedInViewport(page, flyout, `${label} history flyout`);
  const close = flyout.getByLabel('Close activity and history', { exact: true });
  await waitForFocusedLocator(page, close, `${label} opening activity and history`);
  const historySwitch = flyout.getByRole('button', { name: 'History', exact: true });
  await assertHitTarget(page, historySwitch, `${label} history view toggle`);
  const revision = historyItem(page, revisionId);
  await revision.waitFor({ state: 'visible', timeout: 15_000 });
  const preview = revision.getByRole('button', { name: 'Preview', exact: true });
  const restore = revision.getByRole('button', { name: 'Restore', exact: true });
  const isMobile = label.startsWith('mobile');
  if (!isMobile) {
    await assertHitTarget(page, preview, `${label} revision preview action`);
    await assertHitTarget(page, restore, `${label} revision restore action`);
  } else {
    for (const [target, targetLabel] of [
      [toggle, 'activity and history toggle'],
      [close, 'close activity and history'],
      [historySwitch, 'History switch'],
      [preview, 'revision Preview'],
      [restore, 'revision Restore'],
    ] as const) {
      await target.scrollIntoViewIfNeeded();
      await assertHitTarget(page, target, `${label} ${targetLabel}`);
      const bounds = await target.boundingBox();
      assert(bounds !== null && bounds.height >= 44,
        `${label} ${targetLabel} must provide a 44px touch target: ${JSON.stringify(bounds)}.`);
    }
  }
  assertAnchorsStable(before, await snapshotAnchors(page, ANCHORS));
  assert(await renderedCanvasCameraTransform(page, `${label} history open camera`) === beforeCamera,
    `${label} opening history changed the canvas camera.`);

  if (isMobile) {
    await preview.scrollIntoViewIfNeeded();
  }
  await verifiedClick(page, preview, `${label} revision preview action`);
  const cancelPreview = flyout.getByRole('button', { name: 'Cancel preview', exact: true });
  await cancelPreview.waitFor({ state: 'visible', timeout: 15_000 });
  if (isMobile) {
    await cancelPreview.scrollIntoViewIfNeeded();
  }
  await assertHitTarget(page, cancelPreview, `${label} cancel history preview`);
  if (isMobile) {
    const bounds = await cancelPreview.boundingBox();
    assert(bounds !== null && bounds.height >= 44,
      `${label} Cancel preview must provide a 44px touch target: ${JSON.stringify(bounds)}.`);
  }
  await verifiedClick(page, cancelPreview, `${label} cancel history preview`);
  await cancelPreview.waitFor({ state: 'detached', timeout: 15_000 });
  assertAnchorsStable(before, await snapshotAnchors(page, ANCHORS));
  assert(await renderedCanvasCameraTransform(page, `${label} history cancel camera`) === beforeCamera,
    `${label} cancelling history preview changed the canvas camera.`);
  await page.keyboard.press('Escape');
  await flyout.waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, 'activity-flyout-toggle', `${label} closing history with Escape`);
}

async function expectCrossRendererHistoryPreviewCameraHandoff(
  page: Page,
  mcp: ModernMcpClient,
  sessionId: string,
  diagramId: string,
): Promise<void> {
  await mcp.writeLatest(sessionId, diagramId, HISTORY_GENERIC_SEQUENCE, 'Prepared sequence history camera handoff');
  await ensureSourceFlyoutOpen(page);
  await waitForSource(page, HISTORY_GENERIC_SEQUENCE);
  await closeFlyout(page, 'source');
  await waitForCanvas(page, 'sequence');
  const genericHistory = await waitForHistoryRevision(mcp, sessionId, diagramId, HISTORY_GENERIC_SEQUENCE);

  await mcp.writeLatest(sessionId, diagramId, HISTORY_CURRENT_FLOWCHART, 'Prepared live flowchart after sequence history');
  await ensureSourceFlyoutOpen(page);
  await waitForSource(page, HISTORY_CURRENT_FLOWCHART);
  await closeFlyout(page, 'source');
  await waitForCanvas(page, 'flowchart');
  await selectAndZoomHistoryDiagram(page, 0, 'cross-renderer history camera handoff');
  const beforeCamera = await waitForStableCanvasTransform(page, 'cross-renderer history camera baseline');

  await ensureFlyout(page, 'activity');
  const genericRevision = historyItem(page, genericHistory.revision.id);
  await genericRevision.waitFor({ state: 'visible', timeout: 15_000 });
  await verifiedClick(page, genericRevision.getByRole('button', { name: 'Preview', exact: true }), 'cross-renderer historical sequence preview');
  await page.getByTestId('history-preview-notice').waitFor({ state: 'visible', timeout: 15_000 });
  await waitForCanvas(page, 'sequence-readonly');
  assert(await waitForStableCanvasTransform(page, 'cross-renderer sequence history preview camera') === beforeCamera,
    'Cross-renderer history preview changed the active local camera.');

  await verifiedClick(page, page.getByRole('button', { name: 'Cancel preview', exact: true }), 'cross-renderer historical preview cancel');
  await page.getByTestId('history-preview-notice').waitFor({ state: 'detached', timeout: 15_000 });
  await waitForCanvas(page, 'flowchart');
  assert(await waitForStableCanvasTransform(page, 'cross-renderer history cancel camera') === beforeCamera,
    'Cancelling a sequence historical preview into the live flowchart changed the active local camera.');
  await closeFlyout(page, 'activity');
}

async function expectRevisionHistoryCollaboration(
  browser: BrowserHarness,
  baseUrl: string,
  mcpUrl: string,
  sessionId: string,
  mcp: ModernMcpClient,
  roomAccess: RoomAccess,
): Promise<void> {
  const diagramName = 'Revision history E2E';
  const target = await mcp.createDiagramWithLatestRevision(sessionId, diagramName, HISTORY_PREVIOUS_FLOWCHART);
  const observer = await openYjsSessionObserver(mcpUrl, sessionId, { cookie: roomAccess.cookie, origin: baseUrl });
  let page: Page | null = null;
  let peer: Page | null = null;
  try {
    const primary = await browser.newPage(DESKTOP_VIEWPORT);
    const secondary = await browser.newPage(DESKTOP_VIEWPORT);
    page = primary.page;
    peer = secondary.page;
    await Promise.all([
      visitWorkspace(page, baseUrl, sessionId, roomAccess.roomKey),
      visitWorkspace(peer, baseUrl, sessionId, roomAccess.roomKey),
    ]);
    await Promise.all([
      selectTabByName(page, diagramName),
      selectTabByName(peer, diagramName),
    ]);
    await Promise.all([
      ensureSourceFlyoutOpen(page),
      ensureSourceFlyoutOpen(peer),
      waitForCanvas(page, 'flowchart'),
      waitForCanvas(peer, 'flowchart'),
    ]);
    await Promise.all([
      waitForSource(page, HISTORY_PREVIOUS_FLOWCHART),
      waitForSource(peer, HISTORY_PREVIOUS_FLOWCHART),
    ]);
    await Promise.all([closeFlyout(page, 'source'), closeFlyout(peer, 'source')]);
    await Promise.all([waitForCanvas(page, 'flowchart'), waitForCanvas(peer, 'flowchart')]);

    const historical = await waitForHistoryRevision(mcp, sessionId, target.id, HISTORY_PREVIOUS_FLOWCHART);
    assert(Object.keys(historical.revision.nodePositions).length === 0,
      `The requested source-only revision unexpectedly included a layout: ${JSON.stringify(historical.revision.nodePositions)}.`);
    assert(historical.history.revisions.some((revision) => revision.id === historical.revision.id),
      'MCP listDiagramHistory did not expose the revision that readDiagramRevision returned.');

    const movedNodeId = await dragHistoryNode(page, 'history baseline', { x: 102, y: 38 });
    await observer.waitFor(
      (current) => Object.hasOwn(current.snapshot(target.id).nodePositions, movedNodeId),
      'the browser layout checkpoint before the current revision',
    );
    await mcp.writeLatest(sessionId, target.id, HISTORY_CURRENT_FLOWCHART, 'Prepared current history revision');
    await Promise.all([
      ensureSourceFlyoutOpen(page),
      ensureSourceFlyoutOpen(peer),
      waitForSource(page, HISTORY_CURRENT_FLOWCHART),
      waitForSource(peer, HISTORY_CURRENT_FLOWCHART),
    ]);
    await Promise.all([closeFlyout(page, 'source'), closeFlyout(peer, 'source')]);
    await Promise.all([waitForCanvas(page, 'flowchart'), waitForCanvas(peer, 'flowchart')]);
    await selectAndZoomHistoryDiagram(page, 0, 'primary history local state');
    await selectAndZoomHistoryDiagram(peer, 1, 'peer history local state');
    await expect.poll(async () => (await presenceSignature(page)).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => (await presenceSignature(peer)).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);

    const localBeforePreview = await snapshotLocalWorkspace(page, 'primary history preview baseline');
    const peerBeforePreview = await snapshotLocalWorkspace(peer, 'peer history preview baseline');
    const renderedSelectionBeforePreview = await renderedSelectedNodeIds(page);
    assert(renderedSelectionBeforePreview.length > 0, 'History preview click-away fixture did not begin with a selected node.');
    const localAfterPreviewClickAway = { ...localBeforePreview, selected: [] };
    const sharedBeforePreview = observer.snapshot(target.id);
    const previewTracker = observer.trackSnapshot(target.id);
    const desktopAnchors = await snapshotAnchors(page, ANCHORS);
    const currentSvgBeforePreview = await page.locator('.diagram-canvas-svg svg').innerHTML();

    await ensureFlyout(page, 'activity');
    await assertCurrentHistoryCardEdges(page);
    const historicalItem = historyItem(page, historical.revision.id);
    await historicalItem.waitFor({ state: 'visible', timeout: 15_000 });
    await verifiedClick(page, historicalItem.getByRole('button', { name: 'Preview', exact: true }), 'desktop immutable history preview');
    await page.getByTestId('history-preview-notice').waitFor({ state: 'visible', timeout: 15_000 });
    await expect.poll(async () => page.locator('.diagram-canvas-svg svg').innerHTML(), {
      message: 'History preview did not replace the live Mermaid SVG with the requested immutable revision.',
      timeout: 15_000,
    }).not.toBe(currentSvgBeforePreview);
    assert(snapshotsMatch(sharedBeforePreview, observer.snapshot(target.id)), 'History preview wrote canonical Yjs state.');
    const localDuringPreview = await snapshotLocalWorkspace(page, 'primary during history preview');
    const peerDuringPreview = await snapshotLocalWorkspace(peer, 'peer during history preview');
    assert(JSON.stringify(localAfterPreviewClickAway) === JSON.stringify(localDuringPreview),
      `History preview changed local state beyond the expected workspace click-away deselection: expected=${JSON.stringify(localAfterPreviewClickAway)} after=${JSON.stringify(localDuringPreview)}.`);
    assert(JSON.stringify(peerBeforePreview) === JSON.stringify(peerDuringPreview),
      `History preview changed the peer active tab, selection, camera, or Awareness presence: before=${JSON.stringify(peerBeforePreview)} after=${JSON.stringify(peerDuringPreview)}.`);
    assertAnchorsStable(desktopAnchors, await snapshotAnchors(page, ANCHORS));
    assert(await renderedCanvasCameraTransform(page, 'history preview camera') === localBeforePreview.camera,
      'History preview changed the primary canvas camera.');
    await verifiedClick(page, page.getByRole('button', { name: 'Cancel preview', exact: true }), 'desktop immutable history cancel preview');
    await page.getByTestId('history-preview-notice').waitFor({ state: 'detached', timeout: 15_000 });
    await waitForCanvas(page, 'flowchart');
    await expect.poll(() => renderedSelectedNodeIds(page), {
      message: 'Cancelling history preview restored selection after the Preview action explicitly cleared it.',
      timeout: 15_000,
    }).toEqual([]);
    await previewTracker.expectUnchangedFor(HISTORY_NEGATIVE_OBSERVATION_MS, 'detached history preview and cancellation');
    previewTracker.destroy();
    assert(snapshotsMatch(sharedBeforePreview, observer.snapshot(target.id)), 'Cancelling history preview changed canonical Yjs state.');
    const localAfterPreviewCancellation = await snapshotLocalWorkspace(page, 'primary after history preview cancellation');
    assert(JSON.stringify(localAfterPreviewClickAway) === JSON.stringify(localAfterPreviewCancellation),
      `Cancelling history preview changed primary state beyond the expected click-away deselection: expected=${JSON.stringify(localAfterPreviewClickAway)} after=${JSON.stringify(localAfterPreviewCancellation)}.`);
    assert(JSON.stringify(peerBeforePreview) === JSON.stringify(await snapshotLocalWorkspace(peer, 'peer after history preview cancellation')),
      'Cancelling history preview changed peer local state.');

    const historyBeforeRestore = await mcp.listDiagramHistory(sessionId, target.id);
    const activityCountBeforeRestore = observer.snapshot(target.id).activity.length;
    const restoreTracker = observer.trackSnapshot(target.id);
    const serverOrigin = new URL(mcpUrl).origin;
    const currentPath = `/api/sessions/${encodeURIComponent(sessionId)}/diagrams/${encodeURIComponent(target.id)}`;
    const historyPath = `${currentPath}/history`;
    const restorePath = `${currentPath}/history/${encodeURIComponent(historical.revision.id)}/restore`;
    const restoreRequests: Array<{ method: string; path: string }> = [];
    const recordRestoreRequest = (request: { method: () => string; url: () => string }) => {
      const url = new URL(request.url());
      if (url.origin === serverOrigin && (url.pathname === currentPath || url.pathname === restorePath)) {
        restoreRequests.push({ method: request.method(), path: url.pathname });
      }
    };
    page.on('request', recordRestoreRequest);
    try {
      await verifiedClick(page, historicalItem.getByRole('button', { name: 'Restore', exact: true }), 'desktop immutable history restore');
      const confirmation = page.getByTestId('history-restore-confirmation');
      await confirmation.waitFor({ state: 'visible', timeout: 15_000 });
      await verifiedClick(page, confirmation.getByRole('button', { name: 'Confirm restore', exact: true }), 'confirm immutable history restore');
      await observer.waitFor(
        (current) => sourceAndLayoutMatch(current.snapshot(target.id), historical.revision),
        'the restored immutable source and layout in Yjs',
      );
      await Promise.all([waitForCanvas(page, 'flowchart'), waitForCanvas(peer, 'flowchart')]);
      await expect.poll(() => restoreRequests.filter((request) => request.path === currentPath && request.method === 'GET').length, {
        message: `Confirmed restore did not issue one current-head GET: ${JSON.stringify(restoreRequests)}.`,
        timeout: 15_000,
      })
        .toBe(1);
      await expect.poll(() => restoreRequests.filter((request) => request.path === restorePath && request.method === 'POST').length, {
        message: `Confirmed restore did not issue one restore POST: ${JSON.stringify(restoreRequests)}.`,
        timeout: 15_000,
      })
        .toBe(1);
    } finally {
      page.off('request', recordRestoreRequest);
    }
    assert(JSON.stringify(restoreRequests) === JSON.stringify([
      { method: 'GET', path: currentPath },
      { method: 'POST', path: restorePath },
    ]), `Confirmed restore did not perform exactly one fresh GET followed by one POST: ${JSON.stringify(restoreRequests)}.`);
    await restoreTracker.expectUnchangedFor(HISTORY_NEGATIVE_OBSERVATION_MS, 'the post-restore convergence window');
    const restoreAppearances = getYjsSourceLayoutTransitions(restoreTracker.appearances)
      .filter((appearance) => sourceAndLayoutMatch(appearance.snapshot, historical.revision));
    restoreTracker.destroy();
    assert(restoreAppearances.length === 1,
      `Restored source/layout appeared ${restoreAppearances.length} times in the Yjs observer: ${JSON.stringify(restoreAppearances)}.`);
    const historyAfterRestore = await mcp.listDiagramHistory(sessionId, target.id);
    assert(historyAfterRestore.revisions.length === historyBeforeRestore.revisions.length + 1,
      'Confirmed restore did not create exactly one new immutable history revision.');
    const newestRevision = historyAfterRestore.revisions[0];
    assert(newestRevision?.action === 'restored' && newestRevision.restoredFromRevisionId === historical.revision.id,
      `Confirmed restore did not record immutable restore provenance: ${JSON.stringify(newestRevision)}.`);
    const restoredCurrent = await mcp.readDiagram(sessionId, target.id);
    assert(restoredCurrent.mermaidText === historical.revision.mermaidText
      && restoredCurrent.revision === historyAfterRestore.currentRevision,
    'MCP current head did not match the confirmed UI restore.');
    const activityAfterRestore = observer.snapshot(target.id).activity;
    assert(activityAfterRestore.length === activityCountBeforeRestore + 1
      && activityAfterRestore.at(-1)?.action === 'restored'
      && activityAfterRestore.at(-1)?.restoredFromRevisionId === historical.revision.id,
    `Confirmed restore did not append exactly one linked activity item: ${JSON.stringify(activityAfterRestore.slice(-2))}.`);
    await saveScreenshot(page, 'issue-17-history-restored');

    await closeFlyout(page, 'activity');
    await ensureFlyout(page, 'activity');
    const staleItem = historyItem(page, historical.revision.id);
    await staleItem.waitFor({ state: 'visible', timeout: 15_000 });
    const staleRestore = staleItem.getByRole('button', { name: 'Restore', exact: true });
    await prepareHistoryActionForClick(page, staleItem, staleRestore, 'stale layout-only restore candidate');
    await verifiedClick(page, staleRestore, 'stale layout-only restore candidate');
    const staleConfirmation = page.getByTestId('history-restore-confirmation');
    await staleConfirmation.waitFor({ state: 'visible', timeout: 15_000 });
    const staleRestoreRequests: Array<{ method: string; path: string }> = [];
    const recordStaleRestoreRequest = (request: { method: () => string; url: () => string }) => {
      const url = new URL(request.url());
      if (url.origin === serverOrigin && (url.pathname === currentPath || url.pathname === restorePath)) {
        staleRestoreRequests.push({ method: request.method(), path: url.pathname });
      }
    };
    const historyBeforeStaleRestore = await mcp.listDiagramHistory(sessionId, target.id);
    const restoredActivityCountBeforeStale = observer.snapshot(target.id).activity.filter((event) => event.action === 'restored').length;
    const staleTracker = observer.trackSnapshot(target.id);
    let routedStaleRestore = false;
    let headAfterPeerLayout: { mermaidText: string; revision: string } | null = null;
    let releaseHistoryRefresh: () => void = () => {};
    const historyRefreshReleased = new Promise<void>((resolve) => {
      releaseHistoryRefresh = resolve;
    });
    let historyRefreshStarted = false;
    let historyRefreshFinished = false;
    page.on('request', recordStaleRestoreRequest);
    await page.route(`${serverOrigin}${restorePath}`, async (route) => {
      if (routedStaleRestore) {
        await route.continue();
        return;
      }
      routedStaleRestore = true;
      const peerMovedNodeId = await dragHistoryNode(peer, 'layout-only peer stale-restore race', { x: -86, y: 52 });
      await observer.waitFor(
        (current) => Object.hasOwn(current.snapshot(target.id).nodePositions, peerMovedNodeId),
        'the peer layout-only change between restore read and write',
      );
      const currentHead = await mcp.readDiagram(sessionId, target.id);
      headAfterPeerLayout = { mermaidText: currentHead.mermaidText, revision: currentHead.revision };
      await route.continue();
    });
    await page.route(`${serverOrigin}${historyPath}`, async (route) => {
      historyRefreshStarted = true;
      await historyRefreshReleased;
      try {
        await route.continue();
      } finally {
        historyRefreshFinished = true;
      }
    });
    try {
      const staleRestoreResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.origin === serverOrigin
          && url.pathname === restorePath
          && response.request().method() === 'POST';
      }, { timeout: 15_000 });
      await verifiedClick(page, staleConfirmation.getByRole('button', { name: 'Confirm restore', exact: true }), 'confirm stale layout-only restore');
      const response = await staleRestoreResponse;
      assert(response.status() === 409, `Stale restore response was ${response.status()} instead of 409.`);
      await expect.poll(() => staleRestoreRequests.filter((request) => request.path === restorePath && request.method === 'POST').length, {
        message: `Stale restore did not issue one restore POST: ${JSON.stringify(staleRestoreRequests)}.`,
        timeout: 15_000,
      })
        .toBe(1);
    } finally {
      await page.unroute(`${serverOrigin}${restorePath}`);
      page.off('request', recordStaleRestoreRequest);
    }
    assert(routedStaleRestore, 'The stale-restore test did not interpose the layout-only peer update between GET and POST.');
    assert(JSON.stringify(staleRestoreRequests) === JSON.stringify([
      { method: 'GET', path: currentPath },
      { method: 'POST', path: restorePath },
    ]), `Stale restore did not use one fresh GET and one POST: ${JSON.stringify(staleRestoreRequests)}.`);
    assert(headAfterPeerLayout !== null, 'The peer layout-only update did not provide a current head for stale-restore verification.');
    const currentAfterStaleRestore = await mcp.readDiagram(sessionId, target.id);
    assert(currentAfterStaleRestore.revision === headAfterPeerLayout.revision
      && currentAfterStaleRestore.mermaidText === headAfterPeerLayout.mermaidText,
    'A stale restore changed the current head after its 409 response.');
    const staleSnapshot = observer.snapshot(target.id);
    assert(staleSnapshot.mermaidText === HISTORY_PREVIOUS_FLOWCHART
      && JSON.stringify(staleSnapshot.nodePositions) !== JSON.stringify(historical.revision.nodePositions),
    `A layout-only peer change did not leave stale restore as a no-op: ${JSON.stringify(staleSnapshot)}.`);
    await staleTracker.expectUnchangedFor(HISTORY_NEGATIVE_OBSERVATION_MS, 'the stale-restore no-op window');
    staleTracker.destroy();
    const historyAfterStaleRestore = await mcp.listDiagramHistory(sessionId, target.id);
    const restoredActivityCountAfterStale = observer.snapshot(target.id).activity.filter((event) => event.action === 'restored').length;
    assert(historyAfterStaleRestore.revisions.filter((revision) => revision.action === 'restored').length
      === historyBeforeStaleRestore.revisions.filter((revision) => revision.action === 'restored').length,
    'A stale restore appended an immutable restored revision.');
    assert(restoredActivityCountAfterStale === restoredActivityCountBeforeStale,
      'A stale restore appended an activity event instead of remaining a no-op.');
    try {
      await expect.poll(() => historyRefreshStarted, {
        message: 'Stale restore did not start its history refresh.',
        timeout: 15_000,
      }).toBe(true);
      await staleConfirmation.waitFor({ state: 'detached', timeout: 15_000 });
      await expect(staleItem.getByRole('button', { name: 'Restore', exact: true })).toBeEnabled({ timeout: 5_000 });
    } finally {
      releaseHistoryRefresh();
      if (historyRefreshStarted) {
        await expect.poll(() => historyRefreshFinished, {
          message: 'Stale restore history refresh did not finish after release.',
          timeout: 15_000,
        }).toBe(true);
      }
      await page.unroute(`${serverOrigin}${historyPath}`);
    }

    await closeFlyout(page, 'activity');
    await expectHistoryFlyoutSafety(page, 'desktop', historical.revision.id);
    for (const [label, viewport] of [
      ['tablet', TABLET_VIEWPORT],
      ['mobile-390', MOBILE_VIEWPORT],
      ['mobile-320', NARROW_MOBILE_VIEWPORT],
    ] as const) {
      const { page: responsivePage } = await browser.newPage(viewport);
      await visitWorkspace(responsivePage, baseUrl, sessionId, roomAccess.roomKey);
      await selectTabByName(responsivePage, diagramName);
      await waitForCanvas(responsivePage, 'flowchart');
      await expectHistoryFlyoutSafety(responsivePage, label, historical.revision.id);
    }

    await expectCrossRendererHistoryPreviewCameraHandoff(page, mcp, sessionId, target.id);

    const invalidTracker: YjsSessionSnapshotHistory = observer.trackSnapshot(target.id);
    await ensureSourceFlyoutOpen(peer);
    await replaceSource(peer, HISTORY_INVALID_FLOWCHART);
    await waitForInvalidPreview(peer);
    await observer.waitFor(
      (current) => current.snapshot(target.id).mermaidText === HISTORY_INVALID_FLOWCHART,
      'the temporary invalid Mermaid source',
    );
    await ensureSourceFlyoutOpen(page);
    await waitForSource(page, HISTORY_INVALID_FLOWCHART);
    await invalidTracker.expectUnchangedFor(HISTORY_NEGATIVE_OBSERVATION_MS, 'the invalid Mermaid transient observation window');
    invalidTracker.destroy();
    assert(observer.snapshot(target.id).mermaidText === HISTORY_INVALID_FLOWCHART,
      'Temporary invalid Mermaid source auto-reverted instead of remaining the canonical current source.');
    await saveScreenshot(peer, 'issue-17-invalid-transient');
  } finally {
    observer.destroy();
  }
}

async function validateWorkspaceUx(): Promise<void> {
  const results: string[] = [];
  const mobilePinchResiduals: string[] = [];
  const slice = process.env.ARIELCHARTS_E2E_SLICE;
  if (slice !== undefined && slice !== 'history') {
    throw new Error(`Unsupported ARIELCHARTS_E2E_SLICE=${JSON.stringify(slice)}. Expected "history" or no slice.`);
  }
  await withOwnedServices(async ({ baseUrl, mcpUrl, serverUrl }) => {
    const browser = await launchBrowserHarness();
    try {
      const room = await createRoom(serverUrl, baseUrl);
      const roomAccess = await exchangeRoomAccess(serverUrl, baseUrl, room);
      const sessionId = room.sessionId;
      const mcp = new ModernMcpClient(mcpUrl, baseUrl, room);
      if (slice === 'history') {
        const { page: seedPage } = await browser.newPage(DESKTOP_VIEWPORT);
        await visitWorkspace(seedPage, baseUrl, sessionId, room.roomKey);
        await expectRevisionHistoryCollaboration(browser, baseUrl, mcpUrl, sessionId, mcp, roomAccess);
        record(results, 'immutable active-tab history preview, restore, stale layout guard, invalid-source persistence, and responsive history controls');
        return;
      }

        const { page } = await browser.newPage(DESKTOP_VIEWPORT);
      await visitWorkspace(page, baseUrl, sessionId, room.roomKey);
        await expectAgentConnectionModal(page, mcpUrl, sessionId, roomAccess.cookie, 'in-memory');
        record(results, 'fragment-derived room key exposes a copyable MCP bearer prompt');
        await expectThemeContract(page);
        record(results, 'system, light, and dark media resolution plus persistence');
        // The theme contract already reloads after the fragment exchange, so the
        // following check exercises cookie-only access without another navigation.
        await expectAgentConnectionModal(page, mcpUrl, sessionId, roomAccess.cookie, 'cookie-only');
        record(results, 'cookie-only reload hides raw key material and offers reset guidance');
        await selectThemePreference(page, 'light');
      await expectWorkspaceSettings(page, mcpUrl, sessionId, roomAccess.cookie);
      record(results, 'settings, agent connection, focus boundaries, canvas handoff, overlay coexistence, and stable chrome');
      const blankDiagramName = await expectTemplateMenu(page);
      record(results, 'template menu visibility, keyboard navigation, focus return, stable anchors, and blank creation');
      await expectUnstyledNodesUseNeutralThemeColors(page);
      record(results, 'unstyled flowchart nodes use monochrome-neutral theme colors');
      await expectContrastRoles(page);
      record(results, 'activity and interaction/focus contrast roles meet WCAG thresholds');
      await expectStableFlyoutAnchors(page, 'desktop');
      record(results, 'desktop source flyout anchors');
      await expectSourceFlyoutResizeAndCodeOverflow(page);
      record(results, 'desktop source flyout resize, keyboard bounds, stable camera, and unwrapped code overflow');
      await ensureFlyout(page, 'source');
      await saveScreenshot(page, 'issue-14-source');
      await closeFlyout(page, 'source');
      await expectFlyoutExclusivity(page);
      record(results, 'source/activity flyout exclusivity');
      await ensureFlyout(page, 'activity');
      await saveScreenshot(page, 'issue-14-activity');
      await closeFlyout(page, 'activity');
      await expectFlyoutFocusAndEscape(page);
      record(results, 'flyout autofocus, Escape close, and focus return');
      await expectGitHubMermaidCopy(page, baseUrl);
      record(results, 'GitHub Mermaid copy fence, clipboard content, and source preservation');
      const diagramName = await expectTabKeyboardAndRename(page, blankDiagramName);
      record(results, 'blank tab create, rename, and keyboard navigation');
      await selectTabByName(page, diagramName);
      await saveScreenshot(page, 'issue-14-blank');
      await expectTemplateDiagramCreation(page);
      record(results, 'flowchart and API sequence templates render, rename, edit, and remain ordinary diagrams');
      await expectErSemanticEditor(page);
      record(results, 'ER semantic form has hit-tested entity controls, source-safe writes, stable anchors, and no generic graph editor');
      await expectRelationshipArchitectureEditors(page);
      record(results, 'Class, State, and Requirement semantic forms expose hit-tested source-safe controls, preserve anchors/camera, and fail closed for nested state');
      await selectTabByName(page, diagramName);
      await expectMermaidStatesAndToolbar(page);
      record(results, 'flowchart, static, invalid Mermaid, and toolbar action');
      await selectThemePreference(page, 'dark');
      await expectFlatChrome(page);
      record(results, 'flat monochrome chrome has no product shadows while focus and selection remain visible');
      await selectThemePreference(page, 'light');
      await expectRendererTransitionPreservesCamera(page);
      record(results, 'editable/static renderer transition preserves camera and explicit Fit changes it');
      await expectWheelGestureCameraControls(page, 'flowchart renderer', 'flowchart');
      await replaceSource(page, API_SEQUENCE_FIXTURE);
      await waitForCanvas(page, 'sequence');
      await expectWheelGestureCameraControls(page, 'generic Mermaid renderer', 'generic');
      await replaceSource(page, FLOWCHART_FIXTURE);
      await waitForCanvas(page, 'flowchart');
      record(results, 'ordinary wheel pans and ctrl-pinch gently zooms without browser scale changes across renderers');
      await expectBlankCanvasClickClearsSelection(page);
      await replaceSource(page, FLOWCHART_FIXTURE);
      await waitForCanvas(page, 'flowchart');
      record(results, 'blank flowchart click clears selected nodes while generic Mermaid blank-canvas click remains a smoke check');
      await expectRemoteUpdateWithoutAnchorJump(page, mcp, sessionId, diagramName);
      record(results, 'remote update leaves desktop anchors stable');
      await saveScreenshot(page, 'workspace-ux-desktop');

      await expectRevisionHistoryCollaboration(browser, baseUrl, mcpUrl, sessionId, mcp, roomAccess);
      record(results, 'immutable active-tab history preview, restore, stale layout guard, invalid-source persistence, and responsive history controls');

      const { page: activityFitPage } = await browser.newPage(ACTIVITY_FIT_VIEWPORT);
      await visitWorkspace(activityFitPage, baseUrl, sessionId, room.roomKey);
      await selectTabByName(activityFitPage, diagramName);
      await expectActivityFlyoutFitSafety(activityFitPage);
      record(results, 'activity-open Fit keeps graph and selected toolbar in unobscured canvas');

      for (const [label, viewport] of [
        ['tablet', TABLET_VIEWPORT],
        ['mobile-390', MOBILE_VIEWPORT],
        ['mobile-320', NARROW_MOBILE_VIEWPORT],
        ['mobile-landscape', MOBILE_LANDSCAPE_VIEWPORT],
      ] as const) {
        const { page: responsivePage } = await browser.newPage(
          viewport,
          label.startsWith('mobile') ? PHONE_CONTEXT_OPTIONS : undefined,
        );
        await visitWorkspace(responsivePage, baseUrl, sessionId, room.roomKey);
        await expectStableFlyoutAnchors(responsivePage, label);
        await expectResponsiveControls(responsivePage, label, diagramName);
        if (label.startsWith('mobile')) {
          await expectPhoneLiveCodingWorkspace(responsivePage, label, diagramName, mobilePinchResiduals);
          record(results, `${label} touch viewport, tabs, flyouts, camera, final-state overflow, screenshots, and canvas controls`);
        }
        await expectNoDevelopmentIndicator(responsivePage);
        await saveScreenshot(responsivePage, `workspace-ux-${label}`);
        record(results, `${label} anchors and source controls`);
      }
    } finally {
      await browser.close();
    }
  });
  for (const residual of mobilePinchResiduals) {
    console.warn(`MOBILE PINCH RESIDUAL ${residual}`);
  }
  console.log(`WORKSPACE UX E2E PASSED (${results.length} passed, 0 skips)`);
}

validateWorkspaceUx().catch((error) => {
  console.error(describeError(error));
  process.exit(1);
});
