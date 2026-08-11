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
  type YjsSessionObserver,
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

const MERMAID_HIGHLIGHT_BROWSER_FIXTURE = `%%{init: { "theme": "base" }}%%
flowchart LR
  A["Label"]-->B
  classDef hot fill:#ff0
  %% source comment`;

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

const ARCHITECTURE_DIAGRAM_FIXTURE = `architecture-beta
  group platform(cloud)[Platform]
  service api(server)[API] in platform
  service db(database)[Database] in platform
  junction gateway in platform
  api:R --> L:gateway
  gateway:R --> L:db
  align row api gateway db`;
const C4_DIAGRAM_FIXTURE = `C4Context
  Boundary(zone, "Zone") {
    Person(user, "User")
  }
  System(app, "Application")
  Rel(user, app, "Uses")`;
const BLOCK_DIAGRAM_FIXTURE = `block-beta
  columns 3
  api["Public API"]:2
  worker
  block:storage:2
    columns 2
    db["Database"]
  end
  api --> worker
  worker --> db`;
const SWIMLANE_DIAGRAM_FIXTURE = `swimlane-beta LR
  subgraph customer [Customer]
    request[Request]
  end
  subgraph support [Support]
    answer[Answer]
  end
  request --> answer`;
const JOURNEY_DIAGRAM_FIXTURE = `journey
  section Product
  Browse: 5: Customer`;
const GANTT_DIAGRAM_FIXTURE = `gantt
  dateFormat YYYY-MM-DD
  section Build
  Design : design, 2026-01-01, 1d`;
const TIMELINE_DIAGRAM_FIXTURE = `timeline LR
  section Delivery
  2026 : Started`;
const GITGRAPH_DIAGRAM_FIXTURE = `gitGraph
  commit id: "base"
  branch feature
  commit id: "feature"
  checkout main
  commit
  merge feature`;
const EVENT_MODELING_DIAGRAM_FIXTURE = `eventmodeling
  entity Order
  tf 01 cmd Order`;
const KANBAN_DIAGRAM_FIXTURE = `kanban
  todo[Todo]
    design[Design]@{ assigned: "Ava" }
  done[Done]`;
const MINDMAP_DIAGRAM_FIXTURE = `mindmap
  Root
    Child
    Other`;
const TREE_VIEW_DIAGRAM_FIXTURE = `treeView-beta
  root/
    src/
      index.ts
    README.md`;
const ISHIKAWA_DIAGRAM_FIXTURE = `ishikawa-beta
  Delivery delay
  Process
  Equipment`;
const RAILROAD_DIAGRAM_FIXTURES = [
  { addExpression: 'terminal("tail")', editedExpression: 'terminal("end")', header: 'railroad-beta', notation: 'IR', operator: '=', source: `railroad-beta
  start = terminal("x") ;` },
  { addExpression: '"tail"', editedExpression: '"end"', header: 'railroad-ebnf-beta', notation: 'EBNF', operator: '=', source: `railroad-ebnf-beta
  start = "x" ;` },
  { addExpression: '"tail"', editedExpression: '"end"', header: 'railroad-abnf-beta', notation: 'ABNF', operator: '=', source: `railroad-abnf-beta
  start = "x" ;` },
  { addExpression: '"tail"', editedExpression: '"end"', header: 'railroad-peg-beta', notation: 'PEG', operator: '<-', source: `railroad-peg-beta
  start <- "x" ;` },
] as const;
const PIE_DIAGRAM_FIXTURE = `pie
  title Allocation
  "Build" : 3
  "Test" : 2`;
const QUADRANT_DIAGRAM_FIXTURE = `quadrantChart
  title Portfolio
  x-axis Low impact --> High impact
  y-axis Low effort --> High effort
  quadrant-1 Invest
  quadrant-2 Explore
  quadrant-3 Avoid
  quadrant-4 Improve
  Alpha: [0.2, 0.8]
  Beta: [0.7, 0.3]`;
const XY_CHART_DIAGRAM_FIXTURE = `xychart-beta horizontal
  title Revenue
  x-axis "Month" ["Jan", "Feb", "Mar"]
  y-axis "Sales" 0 --> 10
  line "Recurring" [2, 4, 6]
  bar "One time" [1, 3, 5]`;
const RADAR_DIAGRAM_FIXTURE = `radar-beta
  title Team skills
  axis speed ["Speed"]
  axis quality ["Quality"]
  axis safety ["Safety"]
  axis cost ["Cost"]
  curve current ["Current"] { 4, 5, 3, 2 }
  curve target ["Target"] { 5, 5, 4, 3 }
  ticks 5
  min 0
  max 5
  showLegend true
  graticule polygon`;
const SANKEY_DIAGRAM_FIXTURE = `sankey-beta
Source,"Middle, ""quoted""",2
"Middle, ""quoted""",Target,1.5
Source,Target,0.5`;
const PACKET_DIAGRAM_FIXTURE = `packet-beta
  0-3: "Header"
  4-7: "Flags"
  8-15: "Payload"`;
const CYNEFIN_DIAGRAM_FIXTURE = `cynefin-beta
  complex
    "Probe"
    "Emergent"
  complicated
    "Analyze"
  clear
    "Checklist"
  chaotic
    "Stabilize"
  confusion
    "Observe"
    "Sense"
    "Frame"
    "Decide"
  complex --> complicated : "Investigate"
  chaotic --> clear`;
const TREEMAP_DIAGRAM_FIXTURE = `treemap-beta
  "Portfolio"
    "Core": 8
    "Growth": 4`;
const VENN_DIAGRAM_FIXTURE = `venn-beta
  set A ["Alpha"]: 8
  set B ["Beta"]: 6
  union A, B ["Both"]: 2`;
const WARDLEY_DIAGRAM_FIXTURE = `wardley-beta
  anchor User [0.95, 0.1]
  component App [0.75, 0.35] (build) inertia
  component Platform [0.5, 0.55] (buy)
  User -> App
  App +> Platform
  evolve Platform 0.8
  pipeline Platform {
    component Compute [0.6]
    component Storage [0.75]
  }
  note "Customer need" [0.9, 0.15]`;

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

async function focusCurrentDiagramCanvas(page: Page, label: string): Promise<Locator> {
  try {
    await page.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await page.waitForFunction(() => {
      const canvas = document.querySelector<HTMLElement>('[data-testid="diagram-canvas"]');
      if (!canvas) return false;
      if (document.activeElement !== canvas) canvas.focus();
      return document.activeElement === canvas;
    }, undefined, { timeout: 5_000 });
    await page.evaluate('new Promise((resolve) => requestAnimationFrame(resolve))');
    await page.waitForFunction(() => document.activeElement === document.querySelector('[data-testid="diagram-canvas"]'), undefined, { timeout: 5_000 });
    return page.getByTestId('diagram-canvas');
  } catch {
    const focusState = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLElement>('[data-testid="diagram-canvas"]');
      const active = document.activeElement;
      return {
        activeRole: active?.getAttribute('role'),
        activeTag: active?.tagName,
        activeTestId: active?.getAttribute('data-testid'),
        canvasPresent: canvas !== null,
        canvasTabIndex: canvas?.tabIndex ?? null,
      };
    });
    throw new Error(`${label} could not focus the current diagram canvas: ${JSON.stringify(focusState)}.`);
  }
}

const CANVAS_HISTORY_SHORTCUT_PROBE = '__arielchartsCanvasHistoryShortcutProbe';

type CanvasHistoryShortcutProbe = {
  claimed: boolean | null;
  event: {
    activeTestId: string | null;
    canvasIsActive: boolean;
    canvasIsConnected: boolean;
    isTrusted: boolean;
    targetRole: string | null;
    targetTestId: string | null;
  } | null;
  listener: EventListenerObject;
};

async function pressCanvasHistoryShortcut(page: Page, canvas: Locator, shortcut: string, label: string): Promise<void> {
  await page.evaluate((probeKey) => {
    const host = window as typeof window & Record<string, CanvasHistoryShortcutProbe>;
    if (host[probeKey]) {
      throw new Error(`A canvas history shortcut probe was already armed for ${probeKey}.`);
    }
    const state: CanvasHistoryShortcutProbe = {
      claimed: null,
      event: null,
      listener: {
        handleEvent(event) {
          if (!(event instanceof KeyboardEvent)) return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
            const target = event.target instanceof Element ? event.target : null;
            const currentCanvas = document.querySelector('[data-testid="diagram-canvas"]');
            state.event = {
              activeTestId: document.activeElement?.getAttribute('data-testid') ?? null,
              canvasIsActive: document.activeElement === currentCanvas,
              canvasIsConnected: currentCanvas?.isConnected ?? false,
              isTrusted: event.isTrusted,
              targetRole: target?.getAttribute('role') ?? null,
              targetTestId: target?.getAttribute('data-testid') ?? null,
            };
            queueMicrotask(() => { state.claimed = event.defaultPrevented; });
          }
        },
      },
    };
    host[probeKey] = state;
    window.addEventListener('keydown', state.listener);
  }, CANVAS_HISTORY_SHORTCUT_PROBE);

  try {
    await canvas.press(shortcut);
    await page.evaluate('new Promise((resolve) => queueMicrotask(resolve))');
    const probe = await page.evaluate((probeKey) => {
      const host = window as typeof window & Record<string, CanvasHistoryShortcutProbe | undefined>;
      const state = host[probeKey];
      if (!state) return null;
      window.removeEventListener('keydown', state.listener);
      delete host[probeKey];
      return { claimed: state.claimed, event: state.event };
    }, CANVAS_HISTORY_SHORTCUT_PROBE);
    assert(
      probe?.claimed === true
      && probe.event?.isTrusted === true
      && probe.event.canvasIsConnected
      && probe.event.canvasIsActive
      && probe.event.targetTestId === 'diagram-canvas',
      `${label} history shortcut was not claimed by the current canvas handler: ${JSON.stringify(probe)}.`);
  } finally {
    await page.evaluate((probeKey) => {
      const host = window as typeof window & Record<string, CanvasHistoryShortcutProbe | undefined>;
      const state = host[probeKey];
      if (!state) return;
      window.removeEventListener('keydown', state.listener);
      delete host[probeKey];
    }, CANVAS_HISTORY_SHORTCUT_PROBE);
  }
}

async function expectCynefinHistorySource(page: Page, expected: string, stage: string): Promise<void> {
  await expect.poll(() => canonicalSource(page), {
    message: `Cynefin history ${stage} did not settle to the exact expected source.`,
    timeout: 15_000,
  }).toBe(expected);
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
  await expectWorkspaceSettingsDetached(page, 'close-button', async () => {
    await verifiedClick(page, closeButton, 'workspace settings Close');
  });
  const trigger = page.getByTestId(SETTINGS_TRIGGER_TEST_ID);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false', { timeout: 5_000 });
  await waitForFocusedLocator(page, trigger, 'Closing workspace settings');
}

async function readWorkspaceSettingsCloseDiagnostics(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('[data-testid="workspace-settings-dialog"]');
    const form = dialog?.querySelector<HTMLFormElement>('form') ?? null;
    const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]') ?? null;
    const active = document.activeElement;
    const rect = dialog?.getBoundingClientRect();
    const style = dialog ? window.getComputedStyle(dialog) : null;
    return {
      activeElement: active instanceof Element ? {
        id: active.id || null,
        tag: active.tagName.toLowerCase(),
        testId: active.getAttribute('data-testid'),
        text: (active.textContent ?? '').trim().slice(0, 120),
      } : null,
      dialogCount: document.querySelectorAll('[data-testid="workspace-settings-dialog"]').length,
      dialogVisible: !!dialog && style?.display !== 'none' && style?.visibility !== 'hidden'
        && !!rect && rect.width > 0 && rect.height > 0,
      form: form ? { noValidate: form.noValidate, valid: form.checkValidity() } : null,
      submit: submit ? { disabled: submit.disabled, type: submit.type } : null,
      triggerExpanded: document.querySelector('[data-testid="workspace-settings-trigger"]')?.getAttribute('aria-expanded') ?? null,
    };
  });
}

async function expectWorkspaceSettingsDetached(
  page: Page,
  stage: string,
  action: () => Promise<void>,
): Promise<void> {
  const browserErrors: string[] = [];
  const recordBrowserError = (kind: 'console' | 'pageerror', message: string) => {
    if (browserErrors.length < 8) browserErrors.push(`${kind}: ${message.slice(0, 500)}`);
  };
  const onConsole = (message: { text: () => string; type: () => string }) => {
    if (message.type() === 'error') recordBrowserError('console', message.text());
  };
  const onPageError = (error: Error) => { recordBrowserError('pageerror', error.message); };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  try {
    await action();
    await page.getByTestId(SETTINGS_DIALOG_TEST_ID).waitFor({ state: 'detached', timeout: 15_000 });
  } catch (error) {
    const state = await readWorkspaceSettingsCloseDiagnostics(page).catch((diagnosticError) => ({ diagnosticError: describeError(diagnosticError) }));
    throw new Error(`Workspace settings close failed at ${stage}: ${describeError(error)}; diagnostics=${JSON.stringify({ browserErrors, state })}`, { cause: error });
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
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
  const radio = dialog.getByRole('radio', { checked: true, name: new RegExp(`^${label}(?:\\s|$)`, 'u') });
  await expect(radio).toBeChecked();
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });
  });
  await radio.focus();
  await expect(radio).toBeFocused();
  await beginWorkspaceSettingsTransitionTrace(page);
  try {
    await expectWorkspaceSettingsDetached(page, `close-${preference}-theme-with-escape`, async () => {
      await page.keyboard.press('Escape');
    });
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
    window.scrollTo(0, 0);
  });
}

async function resetFixedWorkspaceOrigin(page: Page, label: string): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { resolve(); });
      });
    });
    window.scrollTo(0, 0);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY), {
    message: `${label} semantic-panel acceptance did not begin at the fixed workspace origin.`,
    timeout: 5_000,
  }).toBe(0);
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
  const lastValidSvg = await page.locator('.diagram-canvas-svg > svg').innerHTML();
  await replaceSource(page, 'erDiagram\n  ACCOUNT ||--o{');
  await waitForInvalidPreview(page);
  assert(await page.locator('.diagram-canvas-svg > svg').innerHTML() === lastValidSvg,
    'Invalid ER source replaced the last valid SVG preview.');
}

async function expectRelationshipArchitectureEditors(page: Page): Promise<void> {
  const before = await snapshotAnchors(page, ANCHORS);
  const beforeTransform = await canvasTransform(page);

  await replaceSource(page, CLASS_DIAGRAM_FIXTURE);
  await waitForSource(page, CLASS_DIAGRAM_FIXTURE);
  await page.locator('.diagram-canvas-svg > svg').waitFor({ state: 'visible', timeout: 15_000 });
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
  await page.locator('.diagram-canvas-svg > svg').waitFor({ state: 'visible', timeout: 15_000 });
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
  await page.locator('.diagram-canvas-svg > svg').waitFor({ state: 'visible', timeout: 15_000 });
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
  await replaceSource(page, ARCHITECTURE_DIAGRAM_FIXTURE);
  await waitForSource(page, ARCHITECTURE_DIAGRAM_FIXTURE);
  await page.locator('.diagram-canvas-svg > svg').waitFor({ state: 'visible', timeout: 15_000 });
  await expect(page.getByTestId('diagram-mode')).toContainText('Architecture · editable · form');
  const architectureEditor = page.getByTestId('architecture-editor-controls');
  await architectureEditor.waitFor({ state: 'visible', timeout: 15_000 });
  await closeFlyout(page, 'source');
  const apiService = architectureEditor.getByRole('form', { name: 'Architecture service api editor', exact: true });
  const serviceTitle = apiService.getByLabel('Architecture service api title');
  await assertHitTarget(page, serviceTitle, 'architecture service title control');
  await serviceTitle.fill('Public API');
  await verifiedClick(page, apiService.getByRole('button', { name: 'Save', exact: true }), 'architecture service save control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('service api(server)[Public API] in platform');
  await closeFlyout(page, 'source');
  const edgeEditor = architectureEditor.getByRole('form', { name: 'Architecture edge gateway:R:db:L editor', exact: true });
  await scrollErControlIntoView(edgeEditor);
  const edgeTarget = edgeEditor.getByLabel('Architecture edge gateway:R:db:L target', { exact: true });
  await edgeTarget.selectOption('api');
  await verifiedClick(page, edgeEditor.getByRole('button', { name: 'Save', exact: true }), 'architecture edge save control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('gateway:R --> L:api');
  await closeFlyout(page, 'source');
  await replaceSource(page, C4_DIAGRAM_FIXTURE);
  await waitForSource(page, C4_DIAGRAM_FIXTURE);
  await waitForSemanticMode(page, 'C4 · editable · form');
  const c4Editor = page.getByTestId('c4-editor-controls');
  await c4Editor.waitFor({ state: 'visible', timeout: 15_000 });
  await closeFlyout(page, 'source');
  const addC4 = c4Editor.getByRole('button', { name: 'Add element', exact: true });
  await assertHitTarget(page, addC4, 'C4 add-element control');
  await verifiedClick(page, addC4, 'C4 add-element control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('System(system, "System")');
  await closeFlyout(page, 'source');
  const c4Containment = page.getByTestId('c4-containment-controls');
  await c4Containment.getByLabel('C4 element system boundary', { exact: true }).selectOption('zone');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('    System(system, "System")');
  await closeFlyout(page, 'source');
  await replaceSource(page, 'C4Dynamic\n  Person(user, "User")');
  await waitForSource(page, 'C4Dynamic\n  Person(user, "User")');
  await expect(page.getByTestId('diagram-mode')).toContainText('C4 · source only');
  await expect(page.getByTestId('c4-editor-controls')).toHaveCount(0);

  await replaceSource(page, BLOCK_DIAGRAM_FIXTURE);
  await waitForSource(page, BLOCK_DIAGRAM_FIXTURE);
  await waitForSemanticMode(page, 'Block · editable · form');
  const blockEditor = page.getByTestId('block-editor-controls');
  await blockEditor.waitFor({ state: 'visible', timeout: 15_000 });
  await closeFlyout(page, 'source');
  const addBlock = blockEditor.getByRole('button', { name: 'Add block', exact: true });
  await scrollErControlIntoView(addBlock);
  await assertHitTarget(page, addBlock, 'Block add-node control');
  await verifiedClick(page, addBlock, 'Block add-node control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('item["Block"]');
  await closeFlyout(page, 'source');
  const blockContainment = page.getByTestId('block-containment-controls');
  await blockContainment.getByLabel('Block item composite', { exact: true }).selectOption('storage');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('    item["Block"]');
  await closeFlyout(page, 'source');
  await replaceSource(page, 'block-beta\n  api worker');
  await waitForSource(page, 'block-beta\n  api worker');
  await expect(page.getByTestId('diagram-mode')).toContainText('Block · source only');
  await expect(page.getByTestId('block-editor-controls')).toHaveCount(0);

  await replaceSource(page, SWIMLANE_DIAGRAM_FIXTURE);
  await waitForSource(page, SWIMLANE_DIAGRAM_FIXTURE);
  await waitForSemanticMode(page, 'Swimlane · editable · form');
  const swimlaneEditor = page.getByTestId('swimlane-editor-controls');
  await swimlaneEditor.waitFor({ state: 'visible', timeout: 15_000 });
  await closeFlyout(page, 'source');
  const addLane = swimlaneEditor.getByRole('button', { name: 'Add lane', exact: true });
  await scrollErControlIntoView(addLane);
  await assertHitTarget(page, addLane, 'Swimlane add-lane control');
  await verifiedClick(page, addLane, 'Swimlane add-lane control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('subgraph lane [Lane]');
  await closeFlyout(page, 'source');
  await replaceSource(page, 'swimlane-beta\n  subgraph lane\n    nested[A]\n    subgraph nested\n      item[B]\n    end\n  end');
  await waitForSource(page, 'swimlane-beta\n  subgraph lane\n    nested[A]\n    subgraph nested\n      item[B]\n    end\n  end');
  await expect(page.getByTestId('diagram-mode')).toContainText('Swimlane · source only');
  await expect(page.getByTestId('swimlane-editor-controls')).toHaveCount(0);
  assertAnchorsStable(before, await snapshotAnchors(page, ANCHORS));
  assert(await canvasTransform(page) === beforeTransform, 'Relationship/architecture semantic forms changed the generic Mermaid camera transform.');
}

async function expectTemporalSemanticEditors(page: Page): Promise<void> {
  await replaceSource(page, JOURNEY_DIAGRAM_FIXTURE);
  await waitForSource(page, JOURNEY_DIAGRAM_FIXTURE);
  await waitForSemanticMode(page, 'User journey · editable · form');
  await closeFlyout(page, 'source');
  const journey = page.getByTestId('journey-editor-controls');
  await journey.getByLabel('New journey section').fill('Support');
  await verifiedClick(page, journey.getByRole('button', { name: 'Add section', exact: true }), 'Journey add section control');
  const support = journey.getByRole('form', { name: 'Journey section Support', exact: true });
  await support.getByLabel('Journey section Support label').fill('Help');
  await verifiedClick(page, support.getByRole('button', { name: 'Save', exact: true }), 'Journey edit section control');
  await verifiedClick(page, journey.getByLabel('Move Journey section Help up'), 'Journey reorder section control');
  await verifiedClick(page, journey.getByLabel('Delete Journey section Help'), 'Journey delete section control');
  const addJourney = journey.getByRole('button', { name: 'Add task', exact: true });
  await scrollErControlIntoView(addJourney);
  await assertHitTarget(page, addJourney, 'Journey add task control');
  await verifiedClick(page, addJourney, 'Journey add task control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('Task: 3: Customer');
  await closeFlyout(page, 'source');
  const browse = journey.getByRole('form', { name: 'Journey task Browse', exact: true });
  await expect(browse).toBeVisible({ timeout: 15_000 });
  await browse.getByLabel('Journey task Browse text').fill('Explore');
  await verifiedClick(page, browse.getByRole('button', { name: 'Save', exact: true }), 'Journey edit task control');
  await verifiedClick(page, journey.getByLabel('Move journey task Task up'), 'Journey reorder task control');
  await verifiedClick(page, journey.getByLabel('Delete journey task Task'), 'Journey delete task control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('Explore: 5: Customer');
  await closeFlyout(page, 'source');
  await replaceSource(page, 'journey\n  Task: 6: Customer');
  await waitForSource(page, 'journey\n  Task: 6: Customer');
  await expect(page.getByTestId('journey-editor-controls')).toHaveCount(0);

  await replaceSource(page, GANTT_DIAGRAM_FIXTURE);
  await waitForSource(page, GANTT_DIAGRAM_FIXTURE);
  await waitForSemanticMode(page, 'Gantt · editable · form');
  await closeFlyout(page, 'source');
  const gantt = page.getByTestId('gantt-editor-controls');
  await gantt.getByLabel('New Gantt section').fill('Release');
  await verifiedClick(page, gantt.getByRole('button', { name: 'Add section', exact: true }), 'Gantt add section control');
  const release = gantt.getByRole('form', { name: 'Gantt section Release', exact: true });
  await release.getByLabel('Gantt section Release label').fill('Launch');
  await verifiedClick(page, release.getByRole('button', { name: 'Save', exact: true }), 'Gantt edit section control');
  await verifiedClick(page, gantt.getByLabel('Move Gantt section Launch up'), 'Gantt reorder section control');
  await verifiedClick(page, gantt.getByLabel('Delete Gantt section Launch'), 'Gantt delete section control');
  await expect(gantt.getByLabel('New Gantt task section')).toHaveValue('Build');
  await gantt.getByLabel('New Gantt task section').selectOption('Build');
  await gantt.getByLabel('New Gantt end or duration').fill('0d');
  await gantt.getByLabel('New Gantt task status milestone').check();
  const addGantt = gantt.getByRole('button', { name: 'Add task', exact: true });
  await scrollErControlIntoView(addGantt);
  await assertHitTarget(page, addGantt, 'Gantt add task control');
  await verifiedClick(page, addGantt, 'Gantt add task control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('Task : milestone, task, 2026-01-01, 0d');
  await closeFlyout(page, 'source');
  const design = gantt.getByRole('form', { name: 'Gantt task design', exact: true });
  await design.getByLabel('Gantt task design text').fill('Design review');
  await verifiedClick(page, design.getByRole('button', { name: 'Save', exact: true }), 'Gantt edit task control');
  await verifiedClick(page, gantt.getByLabel('Move Gantt task task up'), 'Gantt reorder task control');
  await verifiedClick(page, gantt.getByLabel('Delete Gantt task task'), 'Gantt delete task control');
  await replaceSource(page, 'gantt\n  dateFormat DD-MM-YYYY\n  Task : task, 01-01-2026, 1d');
  await waitForSource(page, 'gantt\n  dateFormat DD-MM-YYYY\n  Task : task, 01-01-2026, 1d');
  await expect(page.getByTestId('gantt-editor-controls')).toHaveCount(0);

  await replaceSource(page, TIMELINE_DIAGRAM_FIXTURE);
  await waitForSource(page, TIMELINE_DIAGRAM_FIXTURE);
  await waitForSemanticMode(page, 'Timeline · editable · form');
  await closeFlyout(page, 'source');
  const timeline = page.getByTestId('timeline-editor-controls');
  await timeline.getByLabel('New timeline period label', { exact: true }).fill('2027');
  await timeline.getByLabel('New timeline period section').selectOption('Delivery');
  await verifiedClick(page, timeline.getByRole('button', { name: 'Add period', exact: true }), 'Timeline add period control');
  await timeline.getByLabel('New timeline event period').selectOption('2027');
  await verifiedClick(page, timeline.getByRole('button', { name: 'Add event', exact: true }), 'Timeline selected-period add event control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('  2027\n    : Event');
  await closeFlyout(page, 'source');
  const addedPeriod = timeline.getByRole('form', { name: 'Timeline period 2027', exact: true });
  await addedPeriod.getByLabel('Timeline period 2027 label').fill('Future');
  await addedPeriod.getByLabel('Timeline period 2027 destination').selectOption('');
  await verifiedClick(page, addedPeriod.getByRole('button', { name: 'Save', exact: true }), 'Timeline edit and destination control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toMatch(/timeline LR\n  Future\n    : Event\n  section Delivery/);
  await closeFlyout(page, 'source');
  await verifiedClick(page, timeline.getByLabel('Delete timeline period Future'), 'Timeline delete period control');
  await expect(timeline.getByLabel('New timeline event period')).toHaveValue('2026');
  const addTimeline = timeline.getByRole('button', { name: 'Add event', exact: true });
  await scrollErControlIntoView(addTimeline);
  await assertHitTarget(page, addTimeline, 'Timeline add event control');
  await verifiedClick(page, addTimeline, 'Timeline add event control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain(': Event');
  await closeFlyout(page, 'source');
  const started = timeline.getByRole('form', { name: 'Timeline event Started', exact: true });
  await started.getByLabel('Timeline event Started text').fill('Launched');
  await verifiedClick(page, started.getByRole('button', { name: 'Save', exact: true }), 'Timeline edit event control');
  const inlinePeriod = timeline.getByRole('form', { name: 'Timeline period 2026', exact: true });
  await inlinePeriod.getByLabel('Timeline period 2026 label').fill('2025');
  await inlinePeriod.getByLabel('Timeline period 2026 destination').selectOption('');
  const saveInlinePeriod = inlinePeriod.getByRole('button', { name: 'Save', exact: true });
  await assertHitTarget(page, saveInlinePeriod, 'Timeline inline period rename and move control');
  await verifiedClick(page, saveInlinePeriod, 'Timeline inline period rename and move control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toMatch(/timeline LR\n  2025 : Launched\n    : Event\n  section Delivery/);
  await closeFlyout(page, 'source');
  await verifiedClick(page, timeline.getByLabel('Move timeline event Event up'), 'Timeline reorder event control');
  await verifiedClick(page, timeline.getByLabel('Delete timeline event Event'), 'Timeline delete event control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toMatch(/timeline LR\n  2025\n    : Launched\n  section Delivery/);
  await closeFlyout(page, 'source');
  await replaceSource(page, 'timeline\n  accTitle: advanced');
  await waitForSource(page, 'timeline\n  accTitle: advanced');
  await expect(page.getByTestId('timeline-editor-controls')).toHaveCount(0);
}

async function expectBoardSemanticEditors(page: Page): Promise<void> {
  await replaceSource(page, GITGRAPH_DIAGRAM_FIXTURE);
  await waitForSource(page, GITGRAPH_DIAGRAM_FIXTURE);
  await waitForSemanticMode(page, 'Gitgraph · editable · form');
  await closeFlyout(page, 'source');
  const gitGraph = page.getByTestId('gitgraph-editor-controls');
  const addCommit = gitGraph.getByRole('button', { name: 'Add commit', exact: true });
  await assertBoardControl(page, addCommit, 'GitGraph add commit control');
  const anonymousCommit = gitGraph.getByRole('form', { name: 'GitGraph commit 5', exact: true });
  await anonymousCommit.getByLabel('GitGraph commit 5 id', { exact: true }).fill('main');
  await anonymousCommit.getByLabel('GitGraph commit 5 type', { exact: true }).selectOption('HIGHLIGHT');
  await assertAndClickBoardControl(page, anonymousCommit.getByRole('button', { name: 'Save', exact: true }), 'GitGraph anonymous commit optional fields control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('commit id: "main" type: HIGHLIGHT');
  await closeFlyout(page, 'source');
  const bareMerge = gitGraph.getByRole('form', { name: 'GitGraph merge 6', exact: true });
  await bareMerge.getByLabel('GitGraph merge 6 id', { exact: true }).fill('merge-feature');
  await bareMerge.getByLabel('GitGraph merge 6 type', { exact: true }).selectOption('REVERSE');
  await assertAndClickBoardControl(page, bareMerge.getByRole('button', { name: 'Save', exact: true }), 'GitGraph bare merge optional fields control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('merge feature id: "merge-feature" type: REVERSE');
  await closeFlyout(page, 'source');
  await assertAndClickBoardControl(page, addCommit, 'GitGraph add commit control');
  await gitGraph.getByLabel('New GitGraph branch', { exact: true }).fill('release');
  await assertAndClickBoardControl(page, gitGraph.getByRole('button', { name: 'Add branch', exact: true }), 'GitGraph add branch control');
  const releaseBranch = gitGraph.getByRole('form', { name: 'GitGraph branch 8', exact: true });
  await releaseBranch.getByLabel('GitGraph branch 8 order', { exact: true }).fill('3');
  await assertAndClickBoardControl(page, releaseBranch.getByRole('button', { name: 'Save', exact: true }), 'GitGraph branch optional order control');
  await gitGraph.getByLabel('GitGraph checkout branch', { exact: true }).selectOption('release');
  await assertAndClickBoardControl(page, gitGraph.getByRole('button', { name: 'Add checkout', exact: true }), 'GitGraph checkout release control');
  await gitGraph.getByLabel('New GitGraph commit id', { exact: true }).fill('releasework');
  await assertAndClickBoardControl(page, addCommit, 'GitGraph release commit control');
  await gitGraph.getByLabel('GitGraph checkout branch', { exact: true }).selectOption('main');
  await assertAndClickBoardControl(page, gitGraph.getByRole('button', { name: 'Add checkout', exact: true }), 'GitGraph checkout main control');
  await gitGraph.getByLabel('GitGraph merge branch', { exact: true }).selectOption('release');
  await gitGraph.getByLabel('GitGraph merge id', { exact: true }).fill('merge-release');
  await assertAndClickBoardControl(page, gitGraph.getByRole('button', { name: 'Add merge', exact: true }), 'GitGraph merge control');
  await gitGraph.getByLabel('GitGraph cherry-pick commit id', { exact: true }).fill('releasework');
  await assertAndClickBoardControl(page, gitGraph.getByRole('button', { name: 'Add cherry-pick', exact: true }), 'GitGraph cherry-pick control');
  const cherryPick = gitGraph.getByRole('form', { name: 'GitGraph cherry-pick 13', exact: true });
  await cherryPick.getByLabel('GitGraph cherry-pick 13 parent', { exact: true }).fill('commit');
  await assertAndClickBoardControl(page, cherryPick.getByRole('button', { name: 'Save', exact: true }), 'GitGraph cherry-pick optional parent control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toMatch(/branch release order: 3[\s\S]*checkout release[\s\S]*merge release id: "merge-release"[\s\S]*cherry-pick id: "releasework" parent: "commit"/);
  await closeFlyout(page, 'source');
  const deleteCommit = gitGraph.getByLabel('Delete GitGraph commit 7', { exact: true });
  await assertAndClickBoardControl(page, deleteCommit, 'GitGraph delete operation control');
  await replaceSource(page, 'gitGraph\n  checkout missing');
  await waitForSource(page, 'gitGraph\n  checkout missing');
  await expect(page.getByTestId('gitgraph-editor-controls')).toHaveCount(0);

  await replaceSource(page, EVENT_MODELING_DIAGRAM_FIXTURE);
  await waitForSource(page, EVENT_MODELING_DIAGRAM_FIXTURE);
  await waitForSemanticMode(page, 'Event modeling · editable · form');
  await closeFlyout(page, 'source');
  const eventModeling = page.getByTestId('event-modeling-editor-controls');
  const addEntity = eventModeling.getByRole('button', { name: 'Add entity', exact: true });
  await assertBoardControl(page, addEntity, 'Event Modeling add entity control');
  await eventModeling.getByLabel('New Event Modeling entity', { exact: true }).fill('Stock');
  await assertAndClickBoardControl(page, addEntity, 'Event Modeling add entity control');
  await assertAndClickBoardControl(page, eventModeling.getByRole('button', { name: 'Add data', exact: true }), 'Event Modeling add data control');
  await eventModeling.getByLabel('New Event Modeling timeframe index', { exact: true }).fill('02');
  await eventModeling.getByLabel('New Event Modeling timeframe type', { exact: true }).selectOption('evt');
  await eventModeling.getByLabel('New Event Modeling timeframe links', { exact: true }).fill('01');
  await eventModeling.getByLabel('New Event Modeling timeframe data', { exact: true }).selectOption('OrderData');
  await assertAndClickBoardControl(page, eventModeling.getByRole('button', { name: 'Add timeframe', exact: true }), 'Event Modeling add timeframe control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('data OrderData `json`{');
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('tf 02 evt Order ->> 01 [[OrderData]]');
  await closeFlyout(page, 'source');
  const order = eventModeling.getByRole('form', { name: 'Event Modeling entity Order', exact: true });
  await order.getByLabel('Event Modeling entity Order name', { exact: true }).fill('Sales.Order');
  await assertAndClickBoardControl(page, order.getByRole('button', { name: 'Save', exact: true }), 'Event Modeling rename entity control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('entity Sales.Order');
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('tf 01 cmd Sales.Order');
  await closeFlyout(page, 'source');
  await replaceSource(page, 'eventmodeling\n  tf nope evt Start');
  await waitForSource(page, 'eventmodeling\n  tf nope evt Start');
  await expect(page.getByTestId('event-modeling-editor-controls')).toHaveCount(0);

  await replaceSource(page, KANBAN_DIAGRAM_FIXTURE);
  await waitForSource(page, KANBAN_DIAGRAM_FIXTURE);
  await waitForSemanticMode(page, 'Kanban · editable · form');
  await closeFlyout(page, 'source');
  const kanban = page.getByTestId('kanban-editor-controls');
  const addCard = kanban.getByRole('button', { name: 'Add card', exact: true });
  await assertAndClickBoardControl(page, addCard, 'Kanban add card control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('task[Task]');
  await closeFlyout(page, 'source');
  const task = kanban.getByRole('form', { name: 'Kanban card task', exact: true });
  await task.getByLabel('Kanban card task title', { exact: true }).fill('Ship');
  await task.getByLabel('Kanban card task new metadata key', { exact: true }).fill('assigned');
  await task.getByLabel('Kanban card task new metadata value', { exact: true }).fill('Ava, Bea: owner');
  await assertAndClickBoardControl(page, task.getByLabel('Add Kanban card task metadata', { exact: true }), 'Kanban structured metadata add control');
  await assertAndClickBoardControl(page, task.getByRole('button', { name: 'Save', exact: true }), 'Kanban edit card control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('task[Ship]@{ assigned: "Ava, Bea: owner" }');
  await closeFlyout(page, 'source');
  await assertAndClickBoardControl(page, task.getByLabel('Delete Kanban card task', { exact: true }), 'Kanban delete card control');
  await replaceSource(page, 'kanban\n  todo[');
  await waitForSource(page, 'kanban\n  todo[');
  await expect(page.getByTestId('kanban-editor-controls')).toHaveCount(0);
}

async function expectHierarchySemanticEditors(page: Page): Promise<void> {
  const anchorsBefore = await snapshotAnchors(page, ANCHORS);
  await replaceSource(page, MINDMAP_DIAGRAM_FIXTURE); await waitForSource(page, MINDMAP_DIAGRAM_FIXTURE); await waitForSemanticMode(page, 'Mindmap · editable · form'); await closeFlyout(page, 'source');
  const mindmap = page.getByTestId('mindmap-editor-controls'); const addMindmap = mindmap.getByRole('button', { name: 'Add node', exact: true }); await assertTouchTarget(page, addMindmap, 'Mindmap hierarchy add-node control'); await assertAndClickBoardControl(page, addMindmap, 'Mindmap add-node control');
  const mindmapNode = mindmap.getByRole('form', { name: 'Mindmap node Node', exact: true }); await mindmapNode.getByLabel('Mindmap node Node label').fill('Mobile'); await mindmapNode.getByLabel('Mindmap node Node shape').selectOption('rounded'); await mindmapNode.getByLabel('Mindmap node Node classes').fill('client'); await mindmapNode.getByLabel('Mindmap node Node icon').fill('fa fa-phone'); await assertAndClickBoardControl(page, mindmapNode.getByRole('button', { name: 'Save', exact: true }), 'Mindmap edit-node control');
  const mobile = mindmap.getByRole('form', { name: 'Mindmap node Mobile', exact: true }); await mobile.getByLabel('Mindmap node Mobile parent').selectOption({ label: 'Root / Child' }); await ensureSourceFlyoutOpen(page); await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('Child\n      (Mobile)'); await closeFlyout(page, 'source'); await assertAndClickBoardControl(page, mobile.getByLabel('Delete Mindmap node Mobile', { exact: true }), 'Mindmap delete-node control'); await assertAndClickBoardControl(page, mindmap.getByLabel('Move Mindmap node Other up', { exact: true }), 'Mindmap reorder control');
  await replaceSource(page, 'mindmap\n  Root\n    Child:::inline'); await waitForSource(page, 'mindmap\n  Root\n    Child:::inline'); await expect(page.getByTestId('mindmap-editor-controls')).toHaveCount(0);

  await replaceSource(page, TREE_VIEW_DIAGRAM_FIXTURE); await waitForSource(page, TREE_VIEW_DIAGRAM_FIXTURE); await waitForSemanticMode(page, 'Tree view · editable · form'); await closeFlyout(page, 'source');
  const tree = page.getByTestId('treeview-editor-controls'); const addTree = tree.getByRole('button', { name: 'Add node', exact: true }); await assertTouchTarget(page, addTree, 'TreeView hierarchy add-node control'); await assertAndClickBoardControl(page, addTree, 'TreeView add-node control'); const treeNode = tree.getByRole('form', { name: 'TreeView node file.txt', exact: true }); await treeNode.getByLabel('TreeView node file.txt label').fill('package.json'); await treeNode.getByLabel('TreeView node file.txt description').fill('manifest'); await treeNode.getByLabel('TreeView node file.txt classes').fill('config'); await treeNode.getByLabel('TreeView node file.txt icon').fill('json'); await assertAndClickBoardControl(page, treeNode.getByRole('button', { name: 'Save', exact: true }), 'TreeView edit-node control'); const packageJson = tree.getByRole('form', { name: 'TreeView node package.json', exact: true }); await packageJson.getByLabel('TreeView node package.json parent').selectOption({ label: 'root / src' }); await ensureSourceFlyoutOpen(page); await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('src/\n      index.ts\n      package.json'); await closeFlyout(page, 'source'); await assertAndClickBoardControl(page, packageJson.getByLabel('Delete TreeView node package.json', { exact: true }), 'TreeView delete-node control'); await assertAndClickBoardControl(page, tree.getByLabel('Move TreeView node README.md up', { exact: true }), 'TreeView reorder control');
  await replaceSource(page, 'treeView-beta\n  Root\n   Unclear'); await waitForSource(page, 'treeView-beta\n  Root\n   Unclear'); await expect(page.getByTestId('treeview-editor-controls')).toHaveCount(0);

  await replaceSource(page, ISHIKAWA_DIAGRAM_FIXTURE); await waitForSource(page, ISHIKAWA_DIAGRAM_FIXTURE); await waitForSemanticMode(page, 'Ishikawa · editable · form'); await closeFlyout(page, 'source');
  const ishikawa = page.getByTestId('ishikawa-editor-controls'); const effect = ishikawa.getByLabel('Ishikawa effect'); await assertBoardControl(page, effect, 'Ishikawa effect control'); await effect.fill('Delivery risk'); await assertAndClickBoardControl(page, ishikawa.getByRole('button', { name: 'Save effect', exact: true }), 'Ishikawa effect save control'); await ishikawa.getByLabel('New Ishikawa cause').fill('Training'); await ishikawa.getByLabel('New Ishikawa parent').selectOption({ label: 'Process' }); const addCause = ishikawa.getByRole('button', { name: 'Add cause', exact: true }); await assertTouchTarget(page, addCause, 'Ishikawa hierarchy add-cause control'); await assertAndClickBoardControl(page, addCause, 'Ishikawa add-cause control'); await ensureSourceFlyoutOpen(page); await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe('ishikawa-beta\n  Delivery risk\n  Process\n    Training\n  Equipment'); await closeFlyout(page, 'source'); const training = ishikawa.getByRole('form', { name: 'Ishikawa cause Training', exact: true }); await training.getByLabel('Ishikawa cause Training label').fill('Operator training'); await assertAndClickBoardControl(page, training.getByRole('button', { name: 'Save', exact: true }), 'Ishikawa edit-cause control'); const operatorTraining = ishikawa.getByRole('form', { name: 'Ishikawa cause Operator training', exact: true }); await operatorTraining.getByLabel('Ishikawa cause Operator training parent').selectOption({ label: 'Equipment' }); await ensureSourceFlyoutOpen(page); await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toContain('Equipment\n    Operator training'); await closeFlyout(page, 'source'); await assertAndClickBoardControl(page, operatorTraining.getByLabel('Delete Ishikawa cause Operator training', { exact: true }), 'Ishikawa delete-cause control'); await assertAndClickBoardControl(page, ishikawa.getByLabel('Move Ishikawa cause Equipment up', { exact: true }), 'Ishikawa reorder control');
  await replaceSource(page, 'ishikawa-beta\n  Effect\n  Parent\n      Skipped'); await waitForSource(page, 'ishikawa-beta\n  Effect\n  Parent\n      Skipped'); await expect(page.getByTestId('ishikawa-editor-controls')).toHaveCount(0);
  assertAnchorsStable(anchorsBefore, await snapshotAnchors(page, ANCHORS));
}

async function expectRailroadSemanticEditor(page: Page): Promise<void> {
  const anchorsBefore = await snapshotAnchors(page, ANCHORS);
  for (const fixture of RAILROAD_DIAGRAM_FIXTURES) {
    await replaceSource(page, fixture.source);
    await waitForSource(page, fixture.source);
    await waitForSemanticMode(page, 'Railroad · editable · form');
    await closeFlyout(page, 'source');
    const railroad = page.getByTestId('railroad-editor-controls');
    const beforeTransform = await canvasTransform(page);
    const add = railroad.getByRole('button', { name: 'Add production', exact: true });
    await assertTouchTarget(page, add, `Railroad ${fixture.notation} add-production control`);
    await railroad.getByLabel('New Railroad production name').fill('tail');
    await railroad.getByLabel('New Railroad production expression').fill(fixture.addExpression);
    await assertAndClickBoardControl(page, add, `Railroad ${fixture.notation} add-production control`);
    const added = `${fixture.source}\n  tail ${fixture.operator} ${fixture.addExpression} ;`;
    await ensureSourceFlyoutOpen(page);
    await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(added);
    await closeFlyout(page, 'source');

    const tail = railroad.getByRole('form', { name: 'Railroad production tail', exact: true });
    await tail.getByLabel('Railroad production tail expression').fill(fixture.editedExpression);
    await assertAndClickBoardControl(page, tail.getByRole('button', { name: 'Save expression', exact: true }), `Railroad ${fixture.notation} edit-production control`);
    const edited = `${fixture.source}\n  tail ${fixture.operator} ${fixture.editedExpression} ;`;
    await ensureSourceFlyoutOpen(page);
    await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(edited);
    await closeFlyout(page, 'source');

    await tail.getByLabel('Railroad production tail name').fill('end');
    await assertAndClickBoardControl(page, tail.getByLabel('Rename Railroad production tail'), `Railroad ${fixture.notation} rename-production control`);
    const renamed = `${fixture.source}\n  end ${fixture.operator} ${fixture.editedExpression} ;`;
    await ensureSourceFlyoutOpen(page);
    await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(renamed);
    await closeFlyout(page, 'source');

    const end = railroad.getByRole('form', { name: 'Railroad production end', exact: true });
    await assertAndClickBoardControl(page, end.getByLabel('Move Railroad production end up'), `Railroad ${fixture.notation} reorder-production control`);
    const reordered = `${fixture.header}\n  end ${fixture.operator} ${fixture.editedExpression} ;\n  start ${fixture.operator} ${fixture.source.split('\n')[1]!.trim().slice(`start ${fixture.operator} `.length)}`;
    await ensureSourceFlyoutOpen(page);
    await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(reordered);
    await closeFlyout(page, 'source');
    await assertAndClickBoardControl(page, end.getByLabel('Delete Railroad production end'), `Railroad ${fixture.notation} delete-production control`);
    await ensureSourceFlyoutOpen(page);
    await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(fixture.source);
    await closeFlyout(page, 'source');
    assert(await canvasTransform(page) === beforeTransform, `Railroad ${fixture.notation} form operations changed the generic Mermaid camera transform.`);
  }
  const advancedSources = [
    'railroad-beta\n  start = optional(terminal("x")) ;',
    'railroad-ebnf-beta\n  start = ("x") ;',
    'railroad-abnf-beta\n  start = %x41 ;',
    'railroad-peg-beta\n  start <- !word ;',
  ];
  for (const source of advancedSources) {
    await replaceSource(page, source);
    await waitForSource(page, source);
    await expect.poll(() => page.getByTestId('diagram-mode').textContent(), { timeout: 15_000 }).toBe('Railroad · source only');
    await ensureSourceFlyoutOpen(page);
    await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(source);
    await closeFlyout(page, 'source');
    await expect(page.getByTestId('railroad-editor-controls')).toHaveCount(0);
  }
  assertAnchorsStable(anchorsBefore, await snapshotAnchors(page, ANCHORS));
}

async function expectNumericSemanticEditors(page: Page): Promise<void> {
  const anchorsBefore = await snapshotAnchors(page, ANCHORS); const transformBefore = await canvasTransform(page);
  await selectThemePreference(page, 'light');

  await replaceSource(page, PIE_DIAGRAM_FIXTURE); await waitForSource(page, PIE_DIAGRAM_FIXTURE); await waitForSemanticMode(page, 'Pie · editable · form'); await closeFlyout(page, 'source');
  const pie = page.getByTestId('pie-editor-controls'); const addSlice = pie.getByRole('button', { name: 'Add slice', exact: true }); await scrollErControlIntoView(addSlice); await assertTouchTarget(page, addSlice, 'Pie add-slice control');
  await pie.getByLabel('Pie title').fill('Delivery allocation'); await assertAndClickBoardControl(page, pie.getByRole('button', { name: 'Save Pie options', exact: true }), 'Pie options control'); const pieShowData = pie.getByLabel('Pie show data'); await scrollErControlIntoView(pieShowData); await assertTouchTarget(page, pieShowData, 'Pie show-data control'); await pieShowData.check();
  await pie.getByLabel('New Pie slice label').fill('Docs'); await pie.getByLabel('New Pie slice value').fill('1'); await assertAndClickBoardControl(page, addSlice, 'Pie add-slice control');
  const docs = pie.getByRole('form', { name: 'Pie slice Docs', exact: true }); const docsValue = docs.getByLabel('Pie slice Docs value'); await docsValue.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace'); await page.keyboard.type('4.25'); await assertAndClickBoardControl(page, docs.getByRole('button', { name: 'Save', exact: true }), 'Pie edit-slice control'); await assertAndClickBoardControl(page, docs.getByLabel('Move Pie slice Docs up'), 'Pie reorder-slice control'); await assertAndClickBoardControl(page, pie.getByLabel('Delete Pie slice Test'), 'Pie delete-slice control');
  const expectedPie = `pie showData
  title Delivery allocation
  "Build" : 3
  "Docs" : 4.25`;
  await ensureSourceFlyoutOpen(page); await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(expectedPie); await closeFlyout(page, 'source');
  await docsValue.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace'); await assertAndClickBoardControl(page, docs.getByRole('button', { name: 'Save', exact: true }), 'Pie empty numeric control'); await expect(pie.getByRole('alert')).toContainText('finite number'); await expect(docsValue).toHaveValue(''); await ensureSourceFlyoutOpen(page); await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(expectedPie); await closeFlyout(page, 'source');
  await pie.getByLabel('New Pie slice label').fill('Invalid'); const invalidPieValue = pie.getByLabel('New Pie slice value'); await invalidPieValue.fill('-1'); await assertAndClickBoardControl(page, addSlice, 'Pie invalid numeric control'); await expect(page.getByTestId('mutation-error-banner')).toContainText('greater than or equal to zero'); await expect(invalidPieValue).toHaveValue('-1'); await ensureSourceFlyoutOpen(page); await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(expectedPie); await closeFlyout(page, 'source');
  const advancedPie = 'pie title Advanced\n  "A" : 1'; await replaceSource(page, advancedPie); await waitForSource(page, advancedPie); await expect.poll(() => page.getByTestId('diagram-mode').textContent(), { timeout: 15_000 }).toBe('Pie · source only'); await closeFlyout(page, 'source'); await expect(pie).toHaveCount(0);

  await replaceSource(page, QUADRANT_DIAGRAM_FIXTURE); await waitForSource(page, QUADRANT_DIAGRAM_FIXTURE); await waitForSemanticMode(page, 'Quadrant chart · editable · form'); await closeFlyout(page, 'source');
  const quadrant = page.getByTestId('quadrant-editor-controls'); const addPoint = quadrant.getByRole('button', { name: 'Add point', exact: true }); await scrollErControlIntoView(addPoint); await assertTouchTarget(page, addPoint, 'Quadrant add-point control');
  await quadrant.getByLabel('Quadrant title text').fill('Delivery portfolio'); await assertAndClickBoardControl(page, quadrant.getByRole('button', { name: 'Save title', exact: true }), 'Quadrant title control'); await quadrant.getByLabel('Quadrant x-axis start').fill('Small'); await quadrant.getByLabel('Quadrant x-axis end').fill('Large'); await assertAndClickBoardControl(page, quadrant.getByRole('button', { name: 'Save x-axis', exact: true }), 'Quadrant axis control'); await quadrant.getByLabel('Quadrant 1 label text').fill('Commit'); await assertAndClickBoardControl(page, quadrant.getByRole('button', { name: 'Save quadrant 1', exact: true }), 'Quadrant label control');
  await quadrant.getByLabel('New Quadrant point label').fill('Gamma'); await quadrant.getByLabel('New Quadrant point x').fill('0.5'); await quadrant.getByLabel('New Quadrant point y').fill('0.5'); await assertAndClickBoardControl(page, addPoint, 'Quadrant add-point control'); const gamma = quadrant.getByRole('form', { name: 'Quadrant point Gamma', exact: true }); const gammaX = gamma.getByLabel('Quadrant point Gamma x'); const gammaY = gamma.getByLabel('Quadrant point Gamma y'); await gammaX.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace'); await page.keyboard.type('0.625'); await gammaY.fill('Infinity'); await gamma.getByLabel('Quadrant point Gamma radius').fill('6'); await gamma.getByLabel('Quadrant point Gamma color').fill('#336699'); const quadrantBeforeInvalid = `quadrantChart
  title Delivery portfolio
  x-axis Small --> Large
  y-axis Low effort --> High effort
  quadrant-1 Commit
  quadrant-2 Explore
  quadrant-3 Avoid
  quadrant-4 Improve
  Alpha: [0.2, 0.8]
  Beta: [0.7, 0.3]
  Gamma: [0.5, 0.5]`; await assertAndClickBoardControl(page, gamma.getByRole('button', { name: 'Save', exact: true }), 'Quadrant invalid numeric control'); await expect(quadrant.getByRole('alert')).toContainText('finite number'); await expect(gammaX).toHaveValue('0.625'); await expect(gammaY).toHaveValue('Infinity'); await ensureSourceFlyoutOpen(page); await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(quadrantBeforeInvalid); await closeFlyout(page, 'source'); await gammaY.fill('0.4'); await assertAndClickBoardControl(page, gamma.getByRole('button', { name: 'Save', exact: true }), 'Quadrant edit-point control'); await assertAndClickBoardControl(page, gamma.getByLabel('Move Quadrant point Gamma up'), 'Quadrant reorder-point control'); await assertAndClickBoardControl(page, quadrant.getByLabel('Delete Quadrant point Beta'), 'Quadrant delete-point control');
  const expectedQuadrant = `quadrantChart
  title Delivery portfolio
  x-axis Small --> Large
  y-axis Low effort --> High effort
  quadrant-1 Commit
  quadrant-2 Explore
  quadrant-3 Avoid
  quadrant-4 Improve
  Alpha: [0.2, 0.8]
  Gamma: [0.625, 0.4] radius: 6, color: #336699`;
  await ensureSourceFlyoutOpen(page); await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(expectedQuadrant); await closeFlyout(page, 'source');
  const advancedQuadrant = 'quadrantChart\n  title Advanced: source\n  A: [0.5, 0.5]'; await replaceSource(page, advancedQuadrant); await waitForSource(page, advancedQuadrant); await expect.poll(() => page.getByTestId('diagram-mode').textContent(), { timeout: 15_000 }).toBe('Quadrant chart · source only'); await closeFlyout(page, 'source'); await expect(quadrant).toHaveCount(0);

  await replaceSource(page, XY_CHART_DIAGRAM_FIXTURE); await waitForSource(page, XY_CHART_DIAGRAM_FIXTURE); await waitForSemanticMode(page, 'XY chart · editable · form'); await closeFlyout(page, 'source');
  const xy = page.getByTestId('xychart-editor-controls'); const addSeries = xy.getByRole('button', { name: 'Add series', exact: true }); await scrollErControlIntoView(addSeries); await assertTouchTarget(page, addSeries, 'XY add-series control'); await xy.getByLabel('XY chart title').fill('Bookings'); await assertAndClickBoardControl(page, xy.getByRole('button', { name: 'Save XY options', exact: true }), 'XY options control'); await xy.getByLabel('XY chart orientation').selectOption('vertical'); await xy.getByLabel('XY x-axis label').fill('Quarter'); await xy.getByLabel('XY x-axis values').fill('Q1, Q2, Q3'); await assertAndClickBoardControl(page, xy.getByRole('button', { name: 'Save x-axis', exact: true }), 'XY x-axis control'); await xy.getByLabel('XY y-axis label').fill('Units'); await xy.getByLabel('XY y-axis values').fill('0, 12'); await assertAndClickBoardControl(page, xy.getByRole('button', { name: 'Save y-axis', exact: true }), 'XY y-axis control');
  await xy.getByLabel('New XY series label').fill('Forecast'); await xy.getByLabel('New XY series values').fill('4, 5, 7'); await assertAndClickBoardControl(page, addSeries, 'XY add-series control'); const forecast = xy.getByRole('form', { name: 'XY series Forecast', exact: true }); await forecast.getByLabel('XY series Forecast kind').selectOption('bar'); await forecast.getByLabel('XY series Forecast values').fill('5, 6, 8'); await assertAndClickBoardControl(page, forecast.getByRole('button', { name: 'Save', exact: true }), 'XY edit-series control'); await assertAndClickBoardControl(page, forecast.getByLabel('Move XY series Forecast up'), 'XY reorder-series control'); await assertAndClickBoardControl(page, xy.getByLabel('Delete XY series One time'), 'XY delete-series control');
  const expectedXy = `xychart-beta vertical
  title Bookings
  x-axis "Quarter" ["Q1", "Q2", "Q3"]
  y-axis "Units" 0 --> 12
  line "Recurring" [2, 4, 6]
  bar "Forecast" [5, 6, 8]`;
  await ensureSourceFlyoutOpen(page); await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(expectedXy); await closeFlyout(page, 'source');
  const advancedXy = 'xychart-beta\n  x-axis [A, B]\n  bar [1, 2]'; await replaceSource(page, advancedXy); await waitForSource(page, advancedXy); await expect.poll(() => page.getByTestId('diagram-mode').textContent(), { timeout: 15_000 }).toBe('XY chart · source only'); await closeFlyout(page, 'source'); await expect(xy).toHaveCount(0);

  await selectThemePreference(page, 'dark'); await replaceSource(page, RADAR_DIAGRAM_FIXTURE); await waitForSource(page, RADAR_DIAGRAM_FIXTURE); await waitForSemanticMode(page, 'Radar · editable · form'); await closeFlyout(page, 'source');
  const radar = page.getByTestId('radar-editor-controls'); const addCurve = radar.getByRole('button', { name: 'Add curve', exact: true }); await scrollErControlIntoView(addCurve); await assertTouchTarget(page, addCurve, 'Radar add-curve control'); const saveRadarOptions = radar.getByRole('button', { name: 'Save Radar options', exact: true }); await assertAndClickBoardControl(page, saveRadarOptions, 'Radar unchanged options control'); await ensureSourceFlyoutOpen(page); await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(RADAR_DIAGRAM_FIXTURE); await closeFlyout(page, 'source'); await radar.getByLabel('Radar set maximum').uncheck(); await assertAndClickBoardControl(page, saveRadarOptions, 'Radar remove-maximum control'); const radarWithoutMaximum = RADAR_DIAGRAM_FIXTURE.replace('\n  max 5', ''); await ensureSourceFlyoutOpen(page); await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(radarWithoutMaximum); await closeFlyout(page, 'source'); await radar.getByLabel('Radar title text').fill('Updated skills'); await assertAndClickBoardControl(page, radar.getByRole('button', { name: 'Save title', exact: true }), 'Radar title control'); await radar.getByLabel('Radar set maximum').check(); await radar.getByLabel('Radar maximum').fill('6'); await radar.getByLabel('Radar ticks').fill('6'); await radar.getByLabel('Radar graticule').selectOption('circle'); const radarShowLegend = radar.getByLabel('Radar show legend'); await scrollErControlIntoView(radarShowLegend); await assertTouchTarget(page, radarShowLegend, 'Radar show-legend control'); await radarShowLegend.uncheck(); await assertAndClickBoardControl(page, saveRadarOptions, 'Radar options control');
  await radar.getByLabel('New Radar curve name').fill('forecast'); await radar.getByLabel('New Radar curve label').fill('Forecast'); await radar.getByLabel('New Radar curve values').fill('3, 4, 4, 4'); await assertAndClickBoardControl(page, addCurve, 'Radar add-curve control'); const forecastCurve = radar.getByRole('form', { name: 'Radar curve forecast', exact: true }); await forecastCurve.getByLabel('Radar curve forecast values').fill('4, 4, 4, 4'); await assertAndClickBoardControl(page, forecastCurve.getByRole('button', { name: 'Save', exact: true }), 'Radar edit-curve control'); await assertAndClickBoardControl(page, forecastCurve.getByLabel('Move Radar curve forecast up'), 'Radar reorder-curve control'); await assertAndClickBoardControl(page, radar.getByLabel('Delete Radar curve target'), 'Radar delete-curve control');
  await radar.getByLabel('New Radar axis name').fill('scope'); await radar.getByLabel('New Radar axis label').fill('Scope'); await radar.getByLabel('New Radar axis curve values').fill('4, 4'); await assertAndClickBoardControl(page, radar.getByRole('button', { name: 'Add axis', exact: true }), 'Radar add-axis control'); const scope = radar.getByRole('form', { name: 'Radar axis scope', exact: true }); await assertAndClickBoardControl(page, scope.getByLabel('Move Radar axis scope up'), 'Radar reorder-axis control'); await scope.getByLabel('Radar axis scope name').fill('reach'); await scope.getByLabel('Radar axis scope label').fill('Reach'); await assertAndClickBoardControl(page, scope.getByRole('button', { name: 'Save', exact: true }), 'Radar edit-axis control'); await assertAndClickBoardControl(page, radar.getByLabel('Delete Radar axis reach'), 'Radar delete-axis control');
  const expectedRadar = `radar-beta
  title Updated skills
  axis speed ["Speed"]
  axis quality ["Quality"]
  axis safety ["Safety"]
  axis cost ["Cost"]
  curve current ["Current"] { 4, 5, 3, 2 }
  curve forecast ["Forecast"] { 4, 4, 4, 4 }
  ticks 6
  min 0
  showLegend false
  graticule circle
  max 6`;
  await ensureSourceFlyoutOpen(page); await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(expectedRadar); await closeFlyout(page, 'source');
  const advancedRadar = 'radar-beta\n  axis A, B, C\n  curve one{1, 2, 3}'; await replaceSource(page, advancedRadar); await waitForSource(page, advancedRadar); await expect.poll(() => page.getByTestId('diagram-mode').textContent(), { timeout: 15_000 }).toBe('Radar · source only'); await closeFlyout(page, 'source'); await expect(radar).toHaveCount(0);

  await selectThemePreference(page, 'light'); assertAnchorsStable(anchorsBefore, await snapshotAnchors(page, ANCHORS)); assert(await canvasTransform(page) === transformBefore, 'Numeric semantic forms changed the generic Mermaid camera transform.');
}

async function expectFlowSemanticEditors(page: Page): Promise<void> {
  const anchorsBefore = await snapshotAnchors(page, ANCHORS);
  const transformBefore = await canvasTransform(page);

  await replaceSource(page, SANKEY_DIAGRAM_FIXTURE);
  await waitForSource(page, SANKEY_DIAGRAM_FIXTURE);
  await waitForSemanticMode(page, 'Sankey · editable · form');
  await closeFlyout(page, 'source');
  const sankey = page.getByTestId('sankey-editor-controls');
  const addSankey = sankey.getByRole('button', { name: 'Add link', exact: true });
  await scrollErControlIntoView(addSankey);
  await assertTouchTarget(page, addSankey, 'Sankey add-link control');
  await sankey.getByLabel('New Sankey link source').fill('Target');
  await sankey.getByLabel('New Sankey link target').fill('Archive, "cold"');
  await sankey.getByLabel('New Sankey link weight').fill('4');
  await assertAndClickBoardControl(page, addSankey, 'Sankey add-link control');
  const archive = sankey.getByRole('form', { name: 'Sankey link Target to Archive, "cold" weight 4', exact: true });
  await archive.getByLabel('Sankey link Target to Archive, "cold" weight 4 target').fill('Archive, "deep"');
  await archive.getByLabel('Sankey link Target to Archive, "cold" weight 4 weight').fill('4.25');
  await assertAndClickBoardControl(page, archive.getByRole('button', { name: 'Save', exact: true }), 'Sankey edit-link control');
  const deepArchive = sankey.getByRole('form', { name: 'Sankey link Target to Archive, "deep" weight 4.25', exact: true });
  await assertAndClickBoardControl(page, deepArchive.getByLabel('Move Sankey link Target to Archive, "deep" weight 4.25 up'), 'Sankey reorder-link control');
  const middle = sankey.getByRole('form', { name: 'Sankey node Middle, "quoted"', exact: true });
  await middle.getByLabel('Sankey node Middle, "quoted" label').fill('Hub, "central"');
  await assertAndClickBoardControl(page, middle.getByRole('button', { name: 'Rename', exact: true }), 'Sankey atomic node-rename control');
  await assertAndClickBoardControl(page, sankey.getByLabel('Delete Sankey link Source to Target weight 0.5'), 'Sankey delete-link control');
  const expectedSankey = `sankey-beta
Source,"Hub, ""central""",2
"Hub, ""central""",Target,1.5
Target,"Archive, ""deep""",4.25`;
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(expectedSankey);
  await closeFlyout(page, 'source');
  const parallelSankey = 'sankey-beta\nA,B,1\nA,B,2';
  await replaceSource(page, parallelSankey);
  await waitForSource(page, parallelSankey);
  await waitForSemanticMode(page, 'Sankey · editable · form');
  await closeFlyout(page, 'source');
  const parallelEditor = page.getByTestId('sankey-editor-controls');
  await expect(parallelEditor.getByRole('form', { name: 'Sankey link A to B weight 1 (1 of 2)', exact: true })).toBeVisible();
  await expect(parallelEditor.getByRole('form', { name: 'Sankey link A to B weight 2 (2 of 2)', exact: true })).toBeVisible();
  const advancedSankey = 'sankey\nA,B,1';
  await replaceSource(page, advancedSankey);
  await waitForSource(page, advancedSankey);
  await expect.poll(() => page.getByTestId('diagram-mode').textContent(), { timeout: 15_000 }).toBe('Sankey · source only');
  await closeFlyout(page, 'source');
  await expect(sankey).toHaveCount(0);

  await replaceSource(page, PACKET_DIAGRAM_FIXTURE);
  await waitForSource(page, PACKET_DIAGRAM_FIXTURE);
  await waitForSemanticMode(page, 'Packet · editable · form');
  await closeFlyout(page, 'source');
  const packet = page.getByTestId('packet-editor-controls');
  const header = packet.getByRole('form', { name: 'Packet field Header bits 0-3', exact: true });
  const headerWidth = header.getByLabel('Packet field Header bits 0-3 width');
  await headerWidth.fill('5');
  await assertAndClickBoardControl(page, header.getByRole('button', { name: 'Save', exact: true }), 'Packet overlap rejection control');
  await expect(page.getByTestId('mutation-error-banner')).toContainText('contiguous');
  await expect(headerWidth).toHaveValue('5');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(PACKET_DIAGRAM_FIXTURE);
  await closeFlyout(page, 'source');
  await headerWidth.fill('4');
  await assertAndClickBoardControl(page, header.getByRole('button', { name: 'Save', exact: true }), 'Packet exact no-op recovery control');
  await expect(page.getByTestId('mutation-error-banner')).toHaveCount(0);
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(PACKET_DIAGRAM_FIXTURE);
  await closeFlyout(page, 'source');
  await header.getByLabel('Packet field Header bits 0-3 label').fill('Main header');
  await assertAndClickBoardControl(page, header.getByRole('button', { name: 'Save', exact: true }), 'Packet edit-field recovery control');
  const addPacket = packet.getByRole('button', { name: 'Add field', exact: true });
  await scrollErControlIntoView(addPacket);
  await assertTouchTarget(page, addPacket, 'Packet add-field control');
  await packet.getByLabel('New Packet field label').fill('Options');
  await packet.getByLabel('New Packet field start').fill('16');
  await packet.getByLabel('New Packet field width').fill('8');
  await assertAndClickBoardControl(page, addPacket, 'Packet add-field control');
  const flags = packet.getByRole('form', { name: 'Packet field Flags bits 4-7', exact: true });
  await flags.getByLabel('Packet field Flags bits 4-7 label').fill('Control');
  await assertAndClickBoardControl(page, flags.getByRole('button', { name: 'Save', exact: true }), 'Packet edit-field control');
  await assertAndClickBoardControl(page, packet.getByLabel('Move Packet field Payload bits 8-15 up'), 'Packet reflow reorder control');
  await assertAndClickBoardControl(page, packet.getByLabel('Delete Packet field Options bits 16-23'), 'Packet reflow delete control');
  const expectedPacket = `packet-beta
  0-3: "Main header"
  4-11: "Payload"
  12-15: "Control"`;
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(expectedPacket);
  await closeFlyout(page, 'source');
  const repeatedPacket = 'packet-beta\n  0-3: "Reserved"\n  4-7: "Reserved"\n  8-15: "Payload"';
  await replaceSource(page, repeatedPacket);
  await waitForSource(page, repeatedPacket);
  await waitForSemanticMode(page, 'Packet · editable · form');
  await closeFlyout(page, 'source');
  const repeatedEditor = page.getByTestId('packet-editor-controls');
  for (const label of ['Packet field Reserved bits 0-3 (1 of 2)', 'Packet field Reserved bits 4-7 (2 of 2)']) {
    const repeated = repeatedEditor.getByRole('form', { name: label, exact: true });
    await expect(repeated.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await expect(repeated.getByLabel(`Delete ${label}`, { exact: true })).toBeDisabled();
  }
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(repeatedPacket);
  await closeFlyout(page, 'source');
  const advancedPacket = 'packet-beta\n+4: "Relative"';
  await replaceSource(page, advancedPacket);
  await waitForSource(page, advancedPacket);
  await expect.poll(() => page.getByTestId('diagram-mode').textContent(), { timeout: 15_000 }).toBe('Packet · source only');
  await closeFlyout(page, 'source');
  await expect(packet).toHaveCount(0);

  assertAnchorsStable(anchorsBefore, await snapshotAnchors(page, ANCHORS));
  assert(await canvasTransform(page) === transformBefore, 'Sankey/Packet semantic forms changed the generic Mermaid camera transform.');
  assert(await page.locator('.react-flow__node').count() === 0, 'Sankey/Packet semantic forms exposed the generic React Flow editor.');
}

async function cynefinBoundaryPaths(page: Page): Promise<string[]> {
  const root = page.locator('.diagram-canvas-svg > svg');
  await root.waitFor({ state: 'visible', timeout: 15_000 });
  const paths = await root.locator('path.cynefinBoundary, path.cynefinCliff, path.cynefinConfusion').evaluateAll((elements) => (
    elements.map((element) => element.getAttribute('d') ?? '')
  ));
  assert(paths.length === 4 && paths.every(Boolean), `Cynefin boundary paths were incomplete: ${JSON.stringify(paths)}.`);
  return paths;
}

async function expectCynefinSemanticEditor(page: Page): Promise<void> {
  const anchorsBefore = await snapshotAnchors(page, ANCHORS);
  const transformBefore = await canvasTransform(page);
  await replaceSource(page, CYNEFIN_DIAGRAM_FIXTURE);
  await waitForSource(page, CYNEFIN_DIAGRAM_FIXTURE);
  await waitForSemanticMode(page, 'Cynefin · editable · form');
  await closeFlyout(page, 'source');
  const panel = page.getByTestId('cynefin-editor-controls');
  await expect(page.getByRole('complementary', { name: 'Cynefin editor', exact: true })).toBeVisible();
  const addItem = panel.getByRole('button', { name: 'Add item', exact: true });
  await scrollErControlIntoView(addItem);
  await assertTouchTarget(page, addItem, 'Cynefin add-item control');
  for (const domain of ['Complex', 'Complicated', 'Clear', 'Chaotic', 'Confusion']) {
    await expect(panel.getByRole('heading', { name: domain, exact: true })).toHaveCount(1);
  }
  const initialBoundaryPaths = await cynefinBoundaryPaths(page);

  const probe = panel.getByRole('form', { name: 'Cynefin item Complex Probe', exact: true });
  await probe.getByLabel('Cynefin item Complex Probe label').fill('Dirty probe');
  const remoteItemSource = CYNEFIN_DIAGRAM_FIXTURE
    .replace('    "Probe"\n', '')
    .replace('  clear\n', '  clear\n    "Discovery"\n');
  await replaceSource(page, remoteItemSource);
  await waitForSource(page, remoteItemSource);
  await waitForSemanticMode(page, 'Cynefin · editable · form');
  await closeFlyout(page, 'source');
  const discovery = panel.getByRole('form', { name: 'Cynefin item Clear Discovery', exact: true });
  await expect(discovery.getByLabel('Cynefin item Clear Discovery label')).toHaveValue('Dirty probe');
  await expect(discovery.getByLabel('Cynefin item Clear Discovery domain')).toHaveValue('clear');
  await replaceSource(page, CYNEFIN_DIAGRAM_FIXTURE);
  await waitForSource(page, CYNEFIN_DIAGRAM_FIXTURE);
  await waitForSemanticMode(page, 'Cynefin · editable · form');
  await closeFlyout(page, 'source');
  await probe.getByLabel('Cynefin item Complex Probe label').fill('Probe');
  await assertAndClickBoardControl(page, probe.getByRole('button', { name: 'Save', exact: true }), 'Cynefin reconciled item no-op control');

  const canonicalTransition = panel.getByRole('form', { name: 'Cynefin transition Complex to Complicated Investigate', exact: true });
  await canonicalTransition.getByLabel('Cynefin transition Complex to Complicated Investigate source').selectOption('confusion');
  const remoteTransitionSource = CYNEFIN_DIAGRAM_FIXTURE.replace(
    '  complex --> complicated : "Investigate"',
    '  complex --> clear : "Explore"',
  );
  await replaceSource(page, remoteTransitionSource);
  await waitForSource(page, remoteTransitionSource);
  await waitForSemanticMode(page, 'Cynefin · editable · form');
  await closeFlyout(page, 'source');
  const explored = panel.getByRole('form', { name: 'Cynefin transition Complex to Clear Explore', exact: true });
  await expect(explored.getByLabel('Cynefin transition Complex to Clear Explore source')).toHaveValue('confusion');
  await expect(explored.getByLabel('Cynefin transition Complex to Clear Explore target')).toHaveValue('clear');
  await expect(explored.getByLabel('Cynefin transition Complex to Clear Explore label')).toHaveValue('Explore');
  await replaceSource(page, CYNEFIN_DIAGRAM_FIXTURE);
  await waitForSource(page, CYNEFIN_DIAGRAM_FIXTURE);
  await waitForSemanticMode(page, 'Cynefin · editable · form');
  await closeFlyout(page, 'source');
  await canonicalTransition.getByLabel('Cynefin transition Complex to Complicated Investigate source').selectOption('complex');
  await assertAndClickBoardControl(page, canonicalTransition.getByRole('button', { name: 'Save', exact: true }), 'Cynefin reconciled transition no-op control');

  await probe.getByLabel('Cynefin item Complex Probe label').fill('Unsafe dirty');
  const ambiguousSource = 'cynefin-beta\n  complex\n    "Same"\n  complex\n    "Same"';
  await replaceSource(page, ambiguousSource);
  await waitForSource(page, ambiguousSource);
  await expect.poll(() => page.getByTestId('diagram-mode').textContent(), { timeout: 15_000 }).toBe('Cynefin · source only');
  await closeFlyout(page, 'source');
  await replaceSource(page, CYNEFIN_DIAGRAM_FIXTURE);
  await waitForSource(page, CYNEFIN_DIAGRAM_FIXTURE);
  await waitForSemanticMode(page, 'Cynefin · editable · form');
  await closeFlyout(page, 'source');
  await expect(probe.getByLabel('Cynefin item Complex Probe label')).toHaveValue('Probe');

  const addTransition = panel.getByRole('button', { name: 'Add transition', exact: true });
  const investigate = panel.getByRole('form', { name: 'Cynefin transition Complex to Complicated Investigate', exact: true });
  await investigate.getByLabel('Cynefin transition Complex to Complicated Investigate target').selectOption('complex');
  await investigate.getByLabel('Cynefin transition Complex to Complicated Investigate label').fill('Dirty investigate');
  await assertAndClickBoardControl(page, investigate.getByRole('button', { name: 'Save', exact: true }), 'Cynefin invalid edit-transition control');
  const mutationBanner = page.getByTestId('mutation-error-banner');
  await expect(mutationBanner).toContainText('different domains');
  await expect(investigate.getByLabel('Cynefin transition Complex to Complicated Investigate label')).toHaveValue('Dirty investigate');
  await investigate.getByLabel('Cynefin transition Complex to Complicated Investigate target').selectOption('complicated');
  await investigate.getByLabel('Cynefin transition Complex to Complicated Investigate label').fill('Investigate');
  await assertAndClickBoardControl(page, investigate.getByRole('button', { name: 'Save', exact: true }), 'Cynefin exact no-op recovery control');
  await mutationBanner.waitFor({ state: 'detached', timeout: 15_000 });
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(CYNEFIN_DIAGRAM_FIXTURE);
  await closeFlyout(page, 'source');
  await panel.getByLabel('New Cynefin transition target').selectOption('complex');
  await panel.getByLabel('New Cynefin transition label').fill('Loop dirty');
  await assertAndClickBoardControl(page, addTransition, 'Cynefin rejected self-loop control');
  await expect(mutationBanner).toContainText('different domains');
  await expect(panel.getByLabel('New Cynefin transition label')).toHaveValue('Loop dirty');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(CYNEFIN_DIAGRAM_FIXTURE);
  await closeFlyout(page, 'source');
  await panel.getByLabel('New Cynefin transition target').selectOption('clear');
  await assertAndClickBoardControl(page, addTransition, 'Cynefin self-loop recovery control');
  await mutationBanner.waitFor({ state: 'detached', timeout: 15_000 });
  const recoveredTransition = panel.getByRole('form', { name: 'Cynefin transition Complex to Clear Loop dirty', exact: true });
  await assertAndClickBoardControl(page, recoveredTransition.getByLabel('Delete Cynefin transition Complex to Clear Loop dirty'), 'Cynefin recovered transition delete control');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(CYNEFIN_DIAGRAM_FIXTURE);
  await closeFlyout(page, 'source');

  await panel.getByLabel('New Cynefin item label').fill('Experiment');
  await assertAndClickBoardControl(page, addItem, 'Cynefin add-item control');
  const experiment = panel.getByRole('form', { name: 'Cynefin item Complex Experiment', exact: true });
  await experiment.getByLabel('Cynefin item Complex Experiment label').fill('Prototype');
  await experiment.getByLabel('Cynefin item Complex Experiment domain').selectOption('complicated');
  await assertAndClickBoardControl(page, experiment.getByRole('button', { name: 'Save', exact: true }), 'Cynefin edit and cross-domain move control');
  const prototype = panel.getByRole('form', { name: 'Cynefin item Complicated Prototype', exact: true });
  await assertAndClickBoardControl(page, prototype.getByLabel('Move Cynefin item Complicated Prototype up'), 'Cynefin item reorder control');
  await assertAndClickBoardControl(page, panel.getByLabel('Delete Cynefin item Complicated Analyze'), 'Cynefin item delete control');

  await panel.getByLabel('New Cynefin transition source').selectOption('clear');
  await panel.getByLabel('New Cynefin transition target').selectOption('complicated');
  await panel.getByLabel('New Cynefin transition label').fill('Govern');
  await assertAndClickBoardControl(page, addTransition, 'Cynefin add-transition control');
  const govern = panel.getByRole('form', { name: 'Cynefin transition Clear to Complicated Govern', exact: true });
  await govern.getByLabel('Cynefin transition Clear to Complicated Govern source').selectOption('complex');
  await govern.getByLabel('Cynefin transition Clear to Complicated Govern target').selectOption('clear');
  await govern.getByLabel('Cynefin transition Clear to Complicated Govern label').fill('Simplify');
  await assertAndClickBoardControl(page, govern.getByRole('button', { name: 'Save', exact: true }), 'Cynefin edit-transition control');
  const simplify = panel.getByRole('form', { name: 'Cynefin transition Complex to Clear Simplify', exact: true });
  await assertAndClickBoardControl(page, simplify.getByLabel('Move Cynefin transition Complex to Clear Simplify up'), 'Cynefin transition reorder control');
  const beforeDelete = `${CYNEFIN_DIAGRAM_FIXTURE.replace('    "Analyze"\n', '').replace('    "Emergent"\n', '    "Emergent"\n').replace('  complicated\n', '  complicated\n    "Prototype"\n').replace('  chaotic --> clear', '  complex --> clear : "Simplify"\n  chaotic --> clear')}`;
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { timeout: 15_000 }).toBe(beforeDelete);
  await closeFlyout(page, 'source');
  await assertAndClickBoardControl(page, panel.getByLabel('Delete Cynefin transition Chaotic to Clear'), 'Cynefin transition delete control');
  const expected = `cynefin-beta
  complex
    "Probe"
    "Emergent"
  complicated
    "Prototype"
  clear
    "Checklist"
  chaotic
    "Stabilize"
  confusion
    "Observe"
    "Sense"
    "Frame"
    "Decide"
  complex --> complicated : "Investigate"
  complex --> clear : "Simplify"`;
  await ensureSourceFlyoutOpen(page);
  await expectCynefinHistorySource(page, expected, 'post-delete');
  await closeFlyout(page, 'source');

  const undoCanvas = await focusCurrentDiagramCanvas(page, 'Cynefin undo');
  await pressCanvasHistoryShortcut(page, undoCanvas, 'ControlOrMeta+z', 'Cynefin undo');
  await ensureSourceFlyoutOpen(page);
  await expectCynefinHistorySource(page, beforeDelete, 'post-undo');
  const redoCanvas = await focusCurrentDiagramCanvas(page, 'Cynefin redo');
  await pressCanvasHistoryShortcut(page, redoCanvas, 'ControlOrMeta+Shift+z', 'Cynefin redo');
  await expectCynefinHistorySource(page, expected, 'post-redo');
  await closeFlyout(page, 'source');

  expect(await cynefinBoundaryPaths(page)).toEqual(initialBoundaryPaths);
  await selectThemePreference(page, 'dark');
  expect(await cynefinBoundaryPaths(page)).toEqual(initialBoundaryPaths);
  await selectThemePreference(page, 'light');
  expect(await cynefinBoundaryPaths(page)).toEqual(initialBoundaryPaths);

  for (const advanced of [
    'cynefin-beta:\n  complex\n    "Colon header"',
    'cynefin-beta\n  title Advanced\n  complex\n    "Titled"',
    '%%{init: {"cynefin": {"seed": 2}}}%%\ncynefin-beta\n  complex\n    "Configured"',
    '---\nconfig:\n  cynefin:\n    seed: 0\n---\ncynefin-beta\n  complex\n    "Configured in frontmatter"',
    'cynefin-beta\n  complex\n    "One"\n  complex\n    "Two"',
    'cynefin-beta\n  complex --> complex : "Ignored by Mermaid"',
  ]) {
    await replaceSource(page, advanced);
    await waitForSource(page, advanced);
    await expect.poll(() => page.getByTestId('diagram-mode').textContent(), { timeout: 15_000 }).toBe('Cynefin · source only');
    await closeFlyout(page, 'source');
    await expect(panel).toHaveCount(0);
  }
  assertAnchorsStable(anchorsBefore, await snapshotAnchors(page, ANCHORS));
  assert(await canvasTransform(page) === transformBefore, 'Cynefin semantic forms changed the generic Mermaid camera transform.');
  assert(await page.locator('.react-flow__node').count() === 0, 'Cynefin semantic forms exposed the generic React Flow editor.');
}

function treemapControlLabel(path: readonly string[]): string {
  return `Treemap node ${path.map((segment) => JSON.stringify(segment)).join(' / ')}`;
}

function treemapForm(panel: Locator, path: readonly string[]): Locator {
  return panel.getByRole('form', { name: treemapControlLabel(path), exact: true });
}

type MermaidThemeEvidence = {
  fillColors: string[];
  geometryFingerprint: string;
  shapeCount: number;
  strokeColors: string[];
  textColors: string[];
};

async function mermaidThemeEvidence(root: Locator): Promise<MermaidThemeEvidence> {
  return root.evaluate((svg) => {
    const geometryAttributes = [
      'cx', 'cy', 'd', 'dx', 'dy', 'height', 'points', 'r', 'rx', 'ry',
      'transform', 'width', 'x', 'x1', 'x2', 'y', 'y1', 'y2',
    ];
    const geometry = Array.from(svg.querySelectorAll('*')).flatMap((element) => {
      const attributes = geometryAttributes.flatMap((attribute) => {
        const value = (element.getAttribute(attribute) ?? '').trim().replace(/[\s,]+/gu, ' ');
        return value ? [[attribute, value] as const] : [];
      });
      return attributes.length > 0 ? [{ attributes, tag: element.tagName.toLowerCase() }] : [];
    });
    const shapes = Array.from(svg.querySelectorAll('path, rect, circle, ellipse, line, polyline, polygon'));
    const texts = Array.from(svg.querySelectorAll('text'));
    const fillColors = Array.from(new Set(
      shapes
        .map((element) => getComputedStyle(element).fill)
        .filter((value) => Boolean(value) && value !== 'none' && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)'),
    )).sort();
    const strokeColors = Array.from(new Set(
      shapes
        .map((element) => getComputedStyle(element).stroke)
        .filter((value) => Boolean(value) && value !== 'none' && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)'),
    )).sort();
    const textColors = Array.from(new Set(
      texts
        .map((element) => getComputedStyle(element).fill)
        .filter((value) => Boolean(value) && value !== 'none' && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)'),
    )).sort();
    return {
      fillColors,
      geometryFingerprint: JSON.stringify({
        geometry,
        viewBox: (svg.getAttribute('viewBox') ?? '').trim().replace(/[\s,]+/gu, ' '),
      }),
      shapeCount: shapes.length,
      strokeColors,
      textColors,
    };
  });
}

async function expectThemeStableDiagramAndPanelGeometry(
  page: Page,
  panel: Locator,
  family: 'treemap' | 'venn' | 'wardley',
  label: string,
): Promise<void> {
  const panelGeometry = () => panel.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { height: bounds.height, left: bounds.left, top: bounds.top, width: bounds.width };
  });
  const root = page.locator('.diagram-canvas-svg > svg');

  await selectThemePreference(page, 'light');
  await root.waitFor({ state: 'visible', timeout: 15_000 });
  const lightPanel = await panelGeometry();
  const lightDiagram = await mermaidThemeEvidence(root);
  assert(lightPanel.height > 0 && lightPanel.width > 0, `${label} had empty panel geometry: ${JSON.stringify(lightPanel)}.`);
  assert(
    lightDiagram.shapeCount > 0
      && lightDiagram.geometryFingerprint.length > 0
      && lightDiagram.fillColors.length > 0
      && lightDiagram.textColors.length > 0,
    `${label} lacked rendered light-theme geometry or palette evidence: ${JSON.stringify(lightDiagram)}.`,
  );
  await saveScreenshot(page, `issue-55-${family}-light`);

  await selectThemePreference(page, 'dark');
  await expect.poll(async () => {
    const evidence = await mermaidThemeEvidence(root);
    return JSON.stringify([evidence.fillColors, evidence.strokeColors, evidence.textColors]);
  }, { message: `${label} dark palette transition`, timeout: 15_000 }).not.toBe(JSON.stringify([
    lightDiagram.fillColors,
    lightDiagram.strokeColors,
    lightDiagram.textColors,
  ]));
  const darkPanel = await panelGeometry();
  const darkDiagram = await mermaidThemeEvidence(root);
  expect(darkPanel).toEqual(lightPanel);
  expect(darkDiagram.geometryFingerprint).toBe(lightDiagram.geometryFingerprint);
  assert(
    darkDiagram.shapeCount > 0 && darkDiagram.fillColors.length > 0 && darkDiagram.textColors.length > 0,
    `${label} lacked rendered dark-theme geometry or palette evidence: ${JSON.stringify(darkDiagram)}.`,
  );
  await saveScreenshot(page, `issue-55-${family}-dark`);

  await selectThemePreference(page, 'light');
  await expect.poll(async () => {
    const evidence = await mermaidThemeEvidence(root);
    return JSON.stringify([evidence.fillColors, evidence.strokeColors, evidence.textColors]);
  }, { message: `${label} light palette restoration`, timeout: 15_000 }).toBe(JSON.stringify([
    lightDiagram.fillColors,
    lightDiagram.strokeColors,
    lightDiagram.textColors,
  ]));
  expect(await panelGeometry()).toEqual(lightPanel);
  expect((await mermaidThemeEvidence(root)).geometryFingerprint).toBe(lightDiagram.geometryFingerprint);
}

async function writeMcpSourceAndAssertRemoteIsolation(
  page: Page,
  mcp: ModernMcpClient,
  observer: YjsSessionObserver,
  sessionId: string,
  diagramId: string,
  source: string,
  detail: string,
  label: string,
): Promise<void> {
  const beforeIds = new Set(observer.snapshot(diagramId).activity.map((event) => event.id));
  const written = await mcp.writeLatest(sessionId, diagramId, source, detail);
  await observer.waitFor((current) => {
    const snapshot = current.snapshot(diagramId);
    return snapshot.mermaidText === source && snapshot.activity.some((event) => event.detail === detail);
  }, `${label} MCP source and activity`);
  await ensureSourceFlyoutOpen(page);
  await waitForSource(page, source);
  await closeFlyout(page, 'source');
  const addedActivity = observer.snapshot(diagramId).activity.filter(
    (event) => event.diagramId === diagramId && !beforeIds.has(event.id),
  );
  assert(
    addedActivity.length === 1
      && addedActivity[0]?.actorType === 'agent'
      && addedActivity[0]?.detail === detail,
    `${label} did not produce exactly one agent activity event: ${JSON.stringify(addedActivity)}.`,
  );
  const history = await mcp.listDiagramHistory(sessionId, diagramId);
  assert(
    history.currentRevision === written.revision
      && history.revisions.some(
        (revision) => revision.resultRevision === written.revision && revision.origin === 'mcp',
      ),
    `${label} was not recorded as the current MCP revision.`,
  );
  const isolation = observer.trackDiagramSnapshot(diagramId);
  const canvas = await focusCurrentDiagramCanvas(page, `${label} remote undo isolation`);
  await canvas.press('ControlOrMeta+z');
  await isolation.expectUnchangedFor(HISTORY_NEGATIVE_OBSERVATION_MS, `${label} remote undo isolation`);
  isolation.destroy();
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), {
    message: `${label} canonical MCP source`,
    timeout: 15_000,
  }).toBe(source);
  await closeFlyout(page, 'source');
}

async function expectRemoteTreemapVennDraftReconciliation(
  page: Page,
  mcp: ModernMcpClient,
  mcpUrl: string,
  baseUrl: string,
  roomAccess: RoomAccess,
  sessionId: string,
  label: string,
): Promise<void> {
  const returnDiagramName = await activeTabName(page);
  const initialTreemap = `treemap-beta
  "Root"
    "P"
      "A": 1
      "B": 2`;
  const remoteDiagram = await mcp.createDiagramWithLatestRevision(sessionId, `${returnDiagramName} ${label} remote`, initialTreemap);
  const observer = await openYjsSessionObserver(mcpUrl, sessionId, { cookie: roomAccess.cookie, origin: baseUrl });
  try {
    await selectTabByName(page, remoteDiagram.name);
    await ensureSourceFlyoutOpen(page);
    await waitForSource(page, initialTreemap);
    await closeFlyout(page, 'source');
    await waitForSemanticMode(page, 'Treemap · editable · form');
    const treemap = page.getByTestId('treemap-editor-controls');
    const originalA = treemapForm(treemap, ['Root', 'P', 'A']);
    const rejectedTreemap = observer.trackDiagramSnapshot(remoteDiagram.id);
    const originalAValue = originalA.getByLabel(`${treemapControlLabel(['Root', 'P', 'A'])} value`);
    const originalASave = originalA.getByRole('button', { name: 'Save', exact: true });
    await originalAValue.fill('-1');
    await scrollErControlIntoView(originalASave);
    await assertAndClickBoardControl(page, originalASave, `${label} rejected Treemap domain mutation`);
    const treemapError = treemap.getByRole('alert');
    const treemapBanner = page.getByTestId('mutation-error-banner');
    await expect(treemapError).toHaveText('Treemap values must be finite numbers greater than zero.');
    await expect(treemapBanner).toContainText('Treemap values must be finite numbers greater than zero.');
    await assertClosedOverlayToggleBesideError(page, treemapBanner, `${label} Treemap error and overlay coexistence`);
    await expect(originalAValue).toHaveValue('-1');
    const rejectedTreemapCanvas = await focusCurrentDiagramCanvas(page, `${label} rejected Treemap undo`);
    await rejectedTreemapCanvas.press('ControlOrMeta+z');
    await rejectedTreemap.expectUnchangedFor(
      HISTORY_NEGATIVE_OBSERVATION_MS,
      `${label} rejected Treemap source, activity, and undo`,
    );
    rejectedTreemap.destroy();
    await originalAValue.fill('1');
    await scrollErControlIntoView(originalASave);
    await assertAndClickBoardControl(
      page,
      originalASave,
      `${label} Treemap error recovery`,
    );
    await expect(treemapError).toHaveCount(0);
    await expect(treemapBanner).toHaveCount(0);
    await originalA.getByLabel(`${treemapControlLabel(['Root', 'P', 'A'])} label`).fill('Dirty descendant');
    const renamedAncestor = `treemap-beta
  "Root"
    "X"
      "A": 1
      "B": 3`;
    await writeMcpSourceAndAssertRemoteIsolation(
      page,
      mcp,
      observer,
      sessionId,
      remoteDiagram.id,
      renamedAncestor,
      `${label} remote Treemap ancestor rename`,
      `${label} Treemap remote reconciliation`,
    );
    const remoteA = treemapForm(treemap, ['Root', 'X', 'A']);
    await expect(remoteA.getByLabel(`${treemapControlLabel(['Root', 'X', 'A'])} label`)).toHaveValue('Dirty descendant');
    await expect(
      treemapForm(treemap, ['Root', 'X', 'B']).getByLabel(
        `${treemapControlLabel(['Root', 'X', 'B'])} value`,
      ),
    ).toHaveValue('3');

    const initialVenn = `venn-beta
  set A ["Alpha"]: 8
  set B ["Beta"]: 6
  union A, B ["Both"]: 2`;
    await writeMcpSourceAndAssertRemoteIsolation(
      page,
      mcp,
      observer,
      sessionId,
      remoteDiagram.id,
      initialVenn,
      `${label} remote Venn setup`,
      `${label} Venn remote setup`,
    );
    await waitForSemanticMode(page, 'Venn · editable · form');
    const venn = page.getByTestId('venn-editor-controls');
    const rejectedVenn = observer.trackDiagramSnapshot(remoteDiagram.id);
    const setA = venn.getByRole('form', { name: 'Venn set A', exact: true });
    const deleteSetA = setA.getByLabel('Delete Venn set A');
    await scrollErControlIntoView(deleteSetA);
    await assertAndClickBoardControl(page, deleteSetA, `${label} rejected dependent Venn delete`);
    const vennError = venn.getByRole('alert');
    const vennBanner = page.getByTestId('mutation-error-banner');
    await expect(vennError).toHaveText('A Venn set cannot be deleted while intersections depend on it.');
    await expect(vennBanner).toContainText('A Venn set cannot be deleted while intersections depend on it.');
    await assertClosedOverlayToggleBesideError(page, vennBanner, `${label} Venn error and overlay coexistence`);
    const rejectedVennCanvas = await focusCurrentDiagramCanvas(page, `${label} rejected Venn undo`);
    await rejectedVennCanvas.press('ControlOrMeta+z');
    await rejectedVenn.expectUnchangedFor(
      HISTORY_NEGATIVE_OBSERVATION_MS,
      `${label} rejected Venn source, activity, and undo`,
    );
    rejectedVenn.destroy();
    const saveSetA = setA.getByRole('button', { name: 'Save', exact: true });
    await scrollErControlIntoView(saveSetA);
    await assertAndClickBoardControl(
      page,
      saveSetA,
      `${label} Venn error recovery`,
    );
    await expect(vennError).toHaveCount(0);
    await expect(vennBanner).toHaveCount(0);
    const oneSetOverlap = observer.trackDiagramSnapshot(remoteDiagram.id);
    await venn.getByLabel('New Venn overlap sets').selectOption(['A']);
    const addSubset = venn.getByRole('button', { name: 'Add subset', exact: true });
    await scrollErControlIntoView(addSubset);
    await assertAndClickBoardControl(
      page,
      addSubset,
      `${label} rejected one-set Venn overlap`,
    );
    await expect(venn.getByRole('alert')).toHaveText('A Venn overlap requires at least two authored sets.');
    await oneSetOverlap.expectUnchangedFor(
      HISTORY_NEGATIVE_OBSERVATION_MS,
      `${label} one-set Venn overlap no-write`,
    );
    oneSetOverlap.destroy();
    await expect(venn.getByRole('textbox', { name: 'Rename Venn set A', exact: true })).toHaveValue('A');
    const alphaVenn = `venn-beta
  set AlphaSet ["Alpha"]: 8
  set B ["Beta"]: 6
  union AlphaSet, B ["Both"]: 2`;
    await writeMcpSourceAndAssertRemoteIsolation(
      page,
      mcp,
      observer,
      sessionId,
      remoteDiagram.id,
      alphaVenn,
      `${label} remote Venn clean rename`,
      `${label} Venn clean rename`,
    );
    await expect(venn.getByRole('textbox', { name: 'Rename Venn set AlphaSet', exact: true })).toHaveValue('AlphaSet');
    await venn.getByRole('textbox', { name: 'Rename Venn set AlphaSet', exact: true }).fill('Dirty set rename');
    const omegaVenn = alphaVenn
      .replace('set AlphaSet ["Alpha"]: 8', 'set OmegaSet ["Remote Alpha"]: 9')
      .replaceAll('AlphaSet, B', 'OmegaSet, B');
    await writeMcpSourceAndAssertRemoteIsolation(
      page,
      mcp,
      observer,
      sessionId,
      remoteDiagram.id,
      omegaVenn,
      `${label} remote Venn dirty rename`,
      `${label} Venn dirty rename`,
    );
    await expect(venn.getByRole('textbox', { name: 'Rename Venn set OmegaSet', exact: true })).toHaveValue('Dirty set rename');
    await expect(venn.getByLabel('Venn set OmegaSet value')).toHaveValue('9');
  } finally {
    observer.destroy();
    await selectTabByName(page, returnDiagramName);
  }
}

async function expectTreemapAndVennSemanticEditors(
  page: Page,
  mcp: ModernMcpClient,
  mcpUrl: string,
  baseUrl: string,
  roomAccess: RoomAccess,
  sessionId: string,
): Promise<void> {
  const anchorsBefore = await snapshotAnchors(page, ANCHORS);
  const transformBefore = await canvasTransform(page);
  await replaceSource(page, TREEMAP_DIAGRAM_FIXTURE);
  await waitForSource(page, TREEMAP_DIAGRAM_FIXTURE);
  await waitForSemanticMode(page, "Treemap · editable · form");
  await closeFlyout(page, "source");
  const treemap = page.getByTestId("treemap-editor-controls");
  const addTreemap = treemap.getByRole("button", {
    name: "Add node",
    exact: true,
  });
  await assertTouchTarget(page, addTreemap, "Treemap add-node control");
  await expectThemeStableDiagramAndPanelGeometry(page, treemap, 'treemap', 'Treemap semantic panel');
  const growth = treemapForm(treemap, ["Portfolio", "Growth"]);
  const growthValue = growth.getByLabel(
    `${treemapControlLabel(["Portfolio", "Growth"])} value`,
  );
  await growthValue.fill("not-a-number");
  await assertAndClickBoardControl(
    page,
    growth.getByRole("button", { name: "Save", exact: true }),
    "Treemap invalid numeric value",
  );
  await expect(treemap.getByRole("alert")).toContainText("number");
  await expect(growthValue).toHaveValue("not-a-number");
  await growthValue.fill("4");
  await assertAndClickBoardControl(
    page,
    growth.getByRole("button", { name: "Save", exact: true }),
    "Treemap exact no-op recovery",
  );
  await expect(treemap.getByRole("alert")).toHaveCount(0);
  await treemap.getByLabel("New Treemap node label").fill("Holding");
  await treemap.getByLabel("New Treemap node value").fill("");
  await assertAndClickBoardControl(page, addTreemap, "Treemap branch add");
  await treemap.getByLabel("New Treemap node label").fill("Income");
  await treemap.getByLabel("New Treemap node value").fill("3");
  await assertAndClickBoardControl(page, addTreemap, "Treemap leaf add");
  const addedTreemap = `treemap-beta
  "Portfolio"
    "Core": 8
    "Growth": 4
    "Holding"
    "Income": 3`;
  await ensureSourceFlyoutOpen(page);
  await expect
    .poll(() => canonicalSource(page), { message: "Treemap add canonical source", timeout: 15_000 })
    .toBe(addedTreemap);
  await closeFlyout(page, "source");
  const income = treemapForm(treemap, ["Portfolio", "Income"]);
  await income
    .getByLabel(`${treemapControlLabel(["Portfolio", "Income"])} label`)
    .fill("Dividend");
  await assertAndClickBoardControl(
    page,
    income.getByRole("button", { name: "Save", exact: true }),
    "Treemap edit leaf",
  );
  const dividend = treemapForm(treemap, ["Portfolio", "Dividend"]);
  await assertAndClickBoardControl(
    page,
    dividend.getByLabel(
      `Move ${treemapControlLabel(["Portfolio", "Dividend"])} up`,
    ),
    "Treemap reorder subtree",
  );
  await dividend
    .getByLabel(
      `Move ${treemapControlLabel(["Portfolio", "Dividend"])} to parent`,
    )
    .selectOption({ label: '"Portfolio" / "Holding"' });
  const holding = treemapForm(treemap, ["Portfolio", "Holding"]);
  await expect(holding.getByText("Delete subtree (2 nodes)", { exact: true })).toBeVisible();
  await assertAndClickBoardControl(
    page,
    holding.getByLabel(
      `Delete ${treemapControlLabel(["Portfolio", "Holding"])} subtree containing 2 nodes`,
    ),
    "Treemap delete subtree",
  );
  await ensureSourceFlyoutOpen(page);
  await expect
    .poll(() => canonicalSource(page), { message: "Treemap delete canonical source", timeout: 15_000 })
    .toBe(TREEMAP_DIAGRAM_FIXTURE);
  await closeFlyout(page, "source");
  const undoCanvas = await focusCurrentDiagramCanvas(page, "Treemap undo");
  await undoCanvas.press("ControlOrMeta+z");
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { message: "Treemap undo canonical source", timeout: 15_000 })
    .toBe(`treemap-beta
  "Portfolio"
    "Core": 8
    "Growth": 4
    "Holding"
      "Dividend": 3`);
  await closeFlyout(page, "source");
  const advancedTreemap = 'treemap-beta\n  "Root":::important\n    "Leaf": 1';
  await replaceSource(page, advancedTreemap);
  await waitForSource(page, advancedTreemap);
  await expect
    .poll(() => page.getByTestId("diagram-mode").textContent(), {
      timeout: 15_000,
      message: "Treemap advanced family fallback mode",
    })
    .toBe("Treemap · source only");
  await closeFlyout(page, "source");
  await expect(treemap).toHaveCount(0);

  const omittedVenn = `venn-beta
  set A
  set B
  union A, B`;
  await replaceSource(page, omittedVenn);
  await waitForSource(page, omittedVenn);
  await waitForSemanticMode(page, "Venn · editable · form");
  await closeFlyout(page, "source");
  const omittedVennPanel = page.getByTestId("venn-editor-controls");
  const omittedOverlap = omittedVennPanel.getByRole("form", {
    name: "Venn overlap A and B",
    exact: true,
  });
  await expect(omittedVennPanel.getByLabel("Venn set A value")).toHaveValue("10");
  await expect(omittedOverlap.getByLabel("Venn overlap A and B value")).toHaveValue("2.5");
  await omittedOverlap.getByLabel("Venn overlap A and B label").fill("Default overlap");
  await assertAndClickBoardControl(
    page,
    omittedOverlap.getByRole("button", { name: "Save", exact: true }),
    "Venn omitted-size label-only edit",
  );
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { message: "Venn omitted-value canonical source", timeout: 15_000 })
    .toBe(`venn-beta
  set A
  set B
  union A, B["Default overlap"]`);
  await closeFlyout(page, "source");

  await replaceSource(page, VENN_DIAGRAM_FIXTURE);
  await waitForSource(page, VENN_DIAGRAM_FIXTURE);
  await waitForSemanticMode(page, "Venn · editable · form");
  await closeFlyout(page, "source");
  const venn = page.getByTestId("venn-editor-controls");
  const addSubset = venn.getByRole("button", {
    name: "Add subset",
    exact: true,
  });
  await assertTouchTarget(page, addSubset, "Venn authored-set control");
  await venn.getByLabel("New Venn set id").fill("C");
  await venn.getByLabel("New Venn subset value").fill("4");
  await assertAndClickBoardControl(page, addSubset, "Venn add authored set");
  const setC = venn.getByRole("form", { name: "Venn set C", exact: true });
  await setC.getByLabel("Venn set C label").fill("Gamma");
  await assertAndClickBoardControl(
    page,
    setC.getByRole("button", { name: "Save", exact: true }),
    "Venn edit authored set",
  );
  await setC.getByRole("textbox", { name: "Rename Venn set C", exact: true }).fill("GammaSet");
  await assertAndClickBoardControl(
    page,
    setC.getByRole("button", { name: "Save rename Venn set C", exact: true }),
    "Venn atomic set rename",
  );
  await expectThemeStableDiagramAndPanelGeometry(page, venn, 'venn', 'Venn semantic panel');
  await venn
    .getByLabel("New Venn overlap sets")
    .selectOption(["A", "GammaSet"]);
  await venn.getByLabel("New Venn subset value").fill("not-a-number");
  await assertAndClickBoardControl(
    page,
    addSubset,
    "Venn invalid overlap value",
  );
  await expect(venn.getByRole("alert")).toContainText("number");
  await expect(venn.getByLabel("New Venn subset value")).toHaveValue(
    "not-a-number",
  );
  await venn.getByLabel("New Venn subset value").fill("1");
  await assertAndClickBoardControl(page, addSubset, "Venn overlap recovery");
  await expect(venn.getByRole("alert")).toHaveCount(0);
  const overlap = venn.getByRole("form", {
    name: "Venn overlap A and GammaSet",
    exact: true,
  });
  await assertAndClickBoardControl(
    page,
    overlap.getByLabel("Move Venn overlap A and GammaSet up"),
    "Venn overlap reorder",
  );
  const addStyle = venn.getByRole("button", { name: "Add style", exact: true });
  await venn.getByLabel("New Venn style target").selectOption("GammaSet");
  await venn.getByLabel("New Venn style property").selectOption("fill");
  await venn.getByLabel("New Venn style value").fill("#22c55e");
  await assertAndClickBoardControl(
    page,
    addStyle,
    "Venn whitelisted style add",
  );
  const style = venn.getByRole("form", {
    name: "Venn style GammaSet",
    exact: true,
  });
  await style.getByLabel("Venn style GammaSet property").selectOption("stroke");
  await style.getByLabel("Venn style GammaSet value").fill("#166534");
  await assertAndClickBoardControl(
    page,
    style.getByRole("button", { name: "Save", exact: true }),
    "Venn whitelisted style edit",
  );
  await venn.getByLabel("New Venn style target").selectOption("A");
  await venn.getByLabel("New Venn style property").selectOption("fill");
  await venn.getByLabel("New Venn style value").fill("#60a5fa");
  await assertAndClickBoardControl(
    page,
    addStyle,
    "Venn second whitelisted style add",
  );
  const styleA = venn.getByRole("form", { name: "Venn style A", exact: true });
  await assertAndClickBoardControl(
    page,
    styleA.getByLabel("Move Venn style A up"),
    "Venn style reorder",
  );
  await assertAndClickBoardControl(
    page,
    style.getByLabel("Delete Venn style GammaSet"),
    "Venn style delete",
  );
  await assertAndClickBoardControl(
    page,
    styleA.getByLabel("Delete Venn style A"),
    "Venn second style delete",
  );
  await assertAndClickBoardControl(
    page,
    overlap.getByLabel("Delete Venn overlap A and GammaSet"),
    "Venn overlap delete",
  );
  const vennAfterOverlapDelete = `venn-beta
  set A ["Alpha"]: 8
  set B ["Beta"]: 6
  set GammaSet["Gamma"]: 4
  union A, B ["Both"]: 2`;
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), {
    message: "Venn post-overlap-delete canonical source",
    timeout: 15_000,
  }).toBe(vennAfterOverlapDelete);
  const currentVenn = page.getByTestId("venn-editor-controls");
  await currentVenn.waitFor({ state: "visible", timeout: 15_000 });
  await expect(
    currentVenn.getByRole("form", {
      name: "Venn overlap A and GammaSet",
      exact: true,
    }),
  ).toHaveCount(0, { timeout: 15_000 });
  await currentVenn.waitFor({ state: "visible", timeout: 15_000 });
  await closeFlyout(page, "source");
  await waitForSemanticMode(page, "Venn · editable · form");
  const reconciledVenn = page.getByTestId("venn-editor-controls");
  await reconciledVenn.waitFor({ state: "visible", timeout: 15_000 });
  const deleteGammaSet = reconciledVenn
    .getByRole("form", { name: "Venn set GammaSet", exact: true })
    .getByLabel("Delete Venn set GammaSet");
  await assertAndClickBoardControl(
    page,
    deleteGammaSet,
    "Venn authored set delete",
  );
  await ensureSourceFlyoutOpen(page);
  await expect
    .poll(() => canonicalSource(page), { message: "Venn mutation canonical source", timeout: 15_000 })
    .toBe(VENN_DIAGRAM_FIXTURE);
  await closeFlyout(page, "source");
  const vennUndo = await focusCurrentDiagramCanvas(page, "Venn undo");
  await pressCanvasHistoryShortcut(page, vennUndo, "ControlOrMeta+z", "Venn undo");
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { message: "Venn undo canonical source", timeout: 15_000 })
    .toBe(`venn-beta
  set A ["Alpha"]: 8
  set B ["Beta"]: 6
  set GammaSet["Gamma"]: 4
  union A, B ["Both"]: 2`);
  await closeFlyout(page, "source");
  const vennRedo = await focusCurrentDiagramCanvas(page, "Venn redo");
  await pressCanvasHistoryShortcut(page, vennRedo, "ControlOrMeta+Shift+z", "Venn redo");
  await ensureSourceFlyoutOpen(page);
  await expect
    .poll(() => canonicalSource(page), { message: "Venn redo canonical source", timeout: 15_000 })
    .toBe(VENN_DIAGRAM_FIXTURE);
  await closeFlyout(page, "source");
  const advancedVenn = 'venn-beta\n  title Advanced\n  set A: 1';
  await replaceSource(page, advancedVenn);
  await waitForSource(page, advancedVenn);
  await expect
    .poll(() => page.getByTestId("diagram-mode").textContent(), {
      timeout: 15_000,
      message: "Venn advanced family fallback mode",
    })
    .toBe("Venn · source only");
  await closeFlyout(page, "source");
  await expect(venn).toHaveCount(0);
  await expectRemoteTreemapVennDraftReconciliation(
    page,
    mcp,
    mcpUrl,
    baseUrl,
    roomAccess,
    sessionId,
    "desktop",
  );
  await ensureSourceFlyoutOpen(page);
  await waitForSource(page, advancedVenn);
  await waitForCanvas(page, 'generic');
  await expect(page.getByTestId('diagram-mode')).toHaveText('Venn · source only');
  await closeFlyout(page, 'source');
  assertAnchorsStable(anchorsBefore, await snapshotAnchors(page, ANCHORS));
  await expect.poll(() => canvasTransform(page), {
    message: 'Treemap/Venn original-tab camera restoration',
    timeout: 15_000,
  }).toBe(transformBefore);
  assert(
    (await page.locator(".react-flow__node").count()) === 0,
    "Treemap/Venn semantic forms exposed the generic React Flow editor.",
  );
}

async function expectRemoteWardleyDraftReconciliation(
  page: Page,
  mcp: ModernMcpClient,
  mcpUrl: string,
  baseUrl: string,
  roomAccess: RoomAccess,
  sessionId: string,
  label: string,
): Promise<void> {
  const returnDiagramName = await activeTabName(page);
  const remoteDiagram = await mcp.createDiagramWithLatestRevision(
    sessionId,
    `${returnDiagramName} ${label} Wardley remote`,
    WARDLEY_DIAGRAM_FIXTURE,
  );
  const observer = await openYjsSessionObserver(mcpUrl, sessionId, {
    cookie: roomAccess.cookie,
    origin: baseUrl,
  });
  try {
    await selectTabByName(page, remoteDiagram.name);
    await waitForSemanticMode(page, 'Wardley · editable · form');
    await closeFlyout(page, 'source');
    const panel = page.getByTestId('wardley-editor-controls');
    const app = panel.getByRole('form', { name: 'Wardley component App', exact: true });
    await app.getByRole('textbox', { name: 'Wardley component App name', exact: true }).fill('Dirty local name');
    const remoteSource = WARDLEY_DIAGRAM_FIXTURE.replace(
      'component App [0.75, 0.35]',
      'component Service [0.8, 0.35]',
    ).replaceAll('App +>', 'Service +>').replaceAll('User -> App', 'User -> Service');
    await writeMcpSourceAndAssertRemoteIsolation(
      page,
      mcp,
      observer,
      sessionId,
      remoteDiagram.id,
      remoteSource,
      `${label} remote Wardley node rename`,
      `${label} Wardley remote reconciliation`,
    );
    await waitForSemanticMode(page, 'Wardley · editable · form');
    const service = panel.getByRole('form', { name: 'Wardley component Service', exact: true });
    await expect(service.getByRole('textbox', { name: 'Wardley component Service name', exact: true })).toHaveValue('Dirty local name');
    await expect(service.getByLabel('Wardley component Service visibility')).toHaveValue('0.8');
  } finally {
    observer.destroy();
    await selectTabByName(page, returnDiagramName);
  }
}

async function expectWardleySemanticEditor(
  page: Page,
  mcp: ModernMcpClient,
  mcpUrl: string,
  baseUrl: string,
  roomAccess: RoomAccess,
  sessionId: string,
): Promise<void> {
  const anchorsBefore = await snapshotAnchors(page, ANCHORS);
  const transformBefore = await canvasTransform(page);
  await replaceSource(page, WARDLEY_DIAGRAM_FIXTURE);
  await waitForSource(page, WARDLEY_DIAGRAM_FIXTURE);
  await waitForSemanticMode(page, 'Wardley · editable · form');
  await closeFlyout(page, 'source');
  const panel = page.getByTestId('wardley-editor-controls');
  const addNode = panel.getByRole('button', { name: 'Add node', exact: true });
  await assertTouchTarget(page, addNode, 'Wardley add-node control');
  await expectThemeStableDiagramAndPanelGeometry(page, panel, 'wardley', 'Wardley semantic panel');

  const app = panel.getByRole('form', { name: 'Wardley component App', exact: true });
  const appVisibility = app.getByLabel('Wardley component App visibility');
  await appVisibility.fill('-1');
  await assertAndClickBoardControl(page, app.getByRole('button', { name: 'Save', exact: true }), 'Wardley invalid coordinate');
  await expect(panel.getByRole('alert')).toContainText('from 0 to 1');
  await expect(appVisibility).toHaveValue('-1');
  await appVisibility.fill('0.75');
  await assertAndClickBoardControl(page, app.getByRole('button', { name: 'Save', exact: true }), 'Wardley exact no-op recovery');
  await expect(panel.getByRole('alert')).toHaveCount(0);

  await panel.getByLabel('New Wardley node name').fill('API gateway');
  await panel.getByLabel('New Wardley node visibility').fill('0.65');
  await panel.getByLabel('New Wardley node evolution').fill('0.45');
  await panel.getByLabel('New Wardley node strategy').selectOption('outsource');
  await assertAndClickBoardControl(page, addNode, 'Wardley node add');
  const added = panel.getByRole('form', { name: 'Wardley component API gateway', exact: true });
  await added.getByRole('textbox', { name: 'Wardley component API gateway name', exact: true }).fill('Gateway');
  await assertAndClickBoardControl(page, added.getByLabel('Rename Wardley component API gateway'), 'Wardley atomic node rename');

  await panel.getByLabel('New Wardley link source').selectOption('User');
  await panel.getByLabel('New Wardley link kind').selectOption('+>');
  await panel.getByLabel('New Wardley link target').selectOption('Gateway');
  await assertAndClickBoardControl(page, panel.getByRole('button', { name: 'Add link', exact: true }), 'Wardley flow add');
  await panel.getByLabel('New Wardley note text').fill('Second note');
  await assertAndClickBoardControl(page, panel.getByRole('button', { name: 'Add note', exact: true }), 'Wardley note add');
  const secondNote = panel.getByRole('form', { name: 'Wardley note Second note', exact: true });
  await assertAndClickBoardControl(page, secondNote.getByLabel('Move Wardley note Second note up'), 'Wardley note reorder');
  await assertAndClickBoardControl(page, secondNote.getByLabel('Delete Wardley note Second note'), 'Wardley note delete');

  await assertAndClickBoardControl(page, panel.getByLabel('Delete Wardley component Gateway'), 'Wardley node and dependent-flow delete');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { message: 'Wardley exact lifecycle source', timeout: 15_000 }).toBe(WARDLEY_DIAGRAM_FIXTURE);
  await closeFlyout(page, 'source');
  const undoCanvas = await focusCurrentDiagramCanvas(page, 'Wardley undo');
  await undoCanvas.press('ControlOrMeta+z');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { message: 'Wardley undo source', timeout: 15_000 }).toContain('component "Gateway" [0.65, 0.45] (outsource)');
  await closeFlyout(page, 'source');

  const advanced = 'wardley-beta\n  title Advanced\n  component A [0.5, 0.5]';
  await replaceSource(page, advanced);
  await waitForSource(page, advanced);
  await expect.poll(() => page.getByTestId('diagram-mode').textContent(), { message: 'Wardley advanced family fallback', timeout: 15_000 }).toBe('Wardley · source only');
  await closeFlyout(page, 'source');
  await expect(panel).toHaveCount(0);
  await expectRemoteWardleyDraftReconciliation(page, mcp, mcpUrl, baseUrl, roomAccess, sessionId, 'desktop');
  await ensureSourceFlyoutOpen(page);
  await waitForSource(page, advanced);
  await closeFlyout(page, 'source');
  assertAnchorsStable(anchorsBefore, await snapshotAnchors(page, ANCHORS));
  await expect.poll(() => canvasTransform(page), { message: 'Wardley original-tab camera restoration', timeout: 15_000 }).toBe(transformBefore);
  assert(await page.locator('.react-flow__node').count() === 0, 'Wardley exposed React Flow structural controls.');
}

async function assertAndClickBoardControl(
  page: Page,
  target: Locator,
  label: string,
): Promise<void> {
  await scrollErControlIntoView(target);
  await assertHitTarget(page, target, label);
  await verifiedClick(page, target, label);
}

async function assertBoardControl(page: Page, target: Locator, label: string): Promise<void> {
  await scrollErControlIntoView(target);
  await assertHitTarget(page, target, label);
}

async function waitForSemanticMode(page: Page, mode: string): Promise<void> {
  try {
    await expect.poll(() => page.getByTestId('diagram-mode').textContent(), { timeout: 15_000 }).toContain(mode);
  } catch (error) {
    await ensureSourceFlyoutOpen(page);
    console.log(`SEMANTIC MODE DIAGNOSTIC (${mode}): ${await page.getByTestId('source-parse-status').textContent()}`);
    throw error;
  }
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

async function expectOverlaySceneFoundation(page: Page, diagramName: string): Promise<void> {
  await selectTabByName(page, diagramName);
  await verifiedClick(page, page.getByRole('button', { name: 'Overlay tools', exact: true }), 'open overlay tools');
  await verifiedClick(page, page.getByRole('button', { name: 'Add overlay', exact: true }), 'add overlay object');
  const objects = page.locator('[data-testid^="overlay-object-"]');
  await expect(objects).toHaveCount(1);
  await verifiedClick(page, objects.first(), 'select overlay object');
  const beforeMove = await objects.first().boundingBox();
  await verifiedClick(page, page.getByRole('button', { name: 'Move right', exact: true }), 'move overlay object');
  const afterMove = await objects.first().boundingBox();
  assert(Boolean(beforeMove && afterMove && afterMove.x > beforeMove.x), 'Overlay move did not update visible world placement.');
  await verifiedClick(page, page.getByRole('button', { name: 'Bring front', exact: true }), 'reorder overlay object');
  await verifiedClick(page, page.getByRole('button', { name: 'Copy overlay', exact: true }), 'copy overlay object');
  await verifiedClick(page, page.getByRole('button', { name: 'Paste overlay', exact: true }), 'paste overlay object');
  await expect(objects).toHaveCount(2);
  const pastedTestId = await objects.last().getAttribute('data-testid');
  assert(pastedTestId?.startsWith('overlay-object-overlay_'), `Pasted overlay did not expose a stable object id: ${pastedTestId}.`);
  const pastedObject = page.getByTestId(pastedTestId!);

  await selectTabByName(page, 'Main');
  await expect(page.locator('[data-testid^="overlay-object-"]')).toHaveCount(0);
  await selectTabByName(page, diagramName);
  await expect(objects).toHaveCount(2);
  await verifiedClick(page, page.getByRole('button', { name: 'Overlay tools', exact: true }), 'reopen overlay tools after tab switch');
  await verifiedClick(page, pastedObject, 'reselect topmost pasted overlay object');
  await verifiedClick(page, page.getByRole('button', { name: 'Delete overlay', exact: true }), 'delete overlay object');
  await expect(objects).toHaveCount(1);
  await verifiedClick(page, page.getByRole('button', { name: 'Undo overlay', exact: true }), 'undo overlay delete');
  await expect(objects).toHaveCount(2);
  await verifiedClick(page, pastedObject, 'select pasted overlay before history restore');
  await verifiedClick(page, page.getByRole('button', { name: 'Delete overlay', exact: true }), 'delete overlay before history restore');
  await verifiedClick(page, objects.first(), 'select final overlay before history restore');
  await verifiedClick(page, page.getByRole('button', { name: 'Delete overlay', exact: true }), 'delete final overlay before history restore');
  await expect(objects).toHaveCount(0);
  await verifiedClick(page, page.getByRole('button', { name: 'Restore overlay', exact: true }), 'restore prior overlay revision');
  await expect(page.getByText('overlay restored', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(objects).not.toHaveCount(0);
  const topmostTestId = await objects.last().getAttribute('data-testid');
  assert(topmostTestId?.startsWith('overlay-object-overlay_'), `Restored overlay did not expose a stable topmost id: ${topmostTestId}.`);
  const topmostObject = page.getByTestId(topmostTestId!);
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await verifiedClick(page, topmostObject, 'select topmost overlay for semantic anchor');
  await verifiedClick(page, page.getByRole('button', { name: 'Anchor first node', exact: true }), 'anchor overlay to first Mermaid node');
  await expect(topmostObject).not.toHaveAttribute('data-orphaned', 'true');
  const worldBeforePan = await topmostObject.evaluate((element) => ({ x: element.getAttribute('data-world-x'), y: element.getAttribute('data-world-y') }));
  const cameraBeforePan = await readCanvasCameraSnapshot(page, 'overlay pan baseline');
  const boxBeforePan = await topmostObject.boundingBox();
  await dispatchTrustedCanvasWheel(page, 'overlay flowchart pan', 'flowchart', { ctrlKey: false, deltaX: 24, deltaY: 36 });
  const cameraAfterPan = await readCanvasCameraSnapshot(page, 'overlay pan result');
  const boxAfterPan = await topmostObject.boundingBox();
  const worldAfterPan = await topmostObject.evaluate((element) => ({ x: element.getAttribute('data-world-x'), y: element.getAttribute('data-world-y') }));
  assert(worldAfterPan.x === worldBeforePan.x && worldAfterPan.y === worldBeforePan.y, 'Canvas pan changed durable overlay world geometry.');
  assert(Boolean(boxBeforePan && boxAfterPan
    && Math.abs((boxAfterPan.x - boxBeforePan.x) - (cameraAfterPan.panX - cameraBeforePan.panX)) < 1
    && Math.abs((boxAfterPan.y - boxBeforePan.y) - (cameraAfterPan.panY - cameraBeforePan.panY)) < 1),
  'Overlay screen delta did not match the live canvas pan delta.');
  const flowBox = await topmostObject.boundingBox();
  await verifiedClick(page, page.getByRole('button', { name: 'Zoom in', exact: true }), 'zoom flowchart with overlay');
  const zoomedBox = await topmostObject.boundingBox();
  assert(Boolean(flowBox && zoomedBox && zoomedBox.width > flowBox.width), 'Overlay did not follow the React Flow zoom transform.');
  await verifiedClick(page, page.getByRole('button', { name: 'Fit diagram', exact: true }), 'fit flowchart with overlay');
  await expect(topmostObject).toBeVisible();
  await replaceSource(page, API_SEQUENCE_FIXTURE);
  await waitForCanvas(page, 'sequence');
  await expect(topmostObject).toBeVisible();
  await expect(topmostObject).toHaveAttribute('data-orphaned', 'true');
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await expect(topmostObject).not.toHaveAttribute('data-orphaned', 'true');
  await replaceSource(page, '');
  await waitForSource(page, '');
  const deleteOverlay = page.getByRole('button', { name: 'Delete overlay', exact: true });
  while (await objects.count() > 0) {
    if (!await deleteOverlay.isEnabled()) {
      await verifiedClick(page, objects.last(), 'select overlay for scenario cleanup');
    }
    await verifiedClick(page, deleteOverlay, 'delete overlay during scenario cleanup');
  }
  await expect(objects).toHaveCount(0);
  await verifiedClick(page, page.getByRole('button', { name: 'Close overlay tools', exact: true }), 'close overlay tools after scenario');
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

async function expectMermaidSyntaxHighlighting(page: Page, mcp: ModernMcpClient, sessionId: string): Promise<void> {
  await page.emulateMedia({ forcedColors: 'none' });
  await selectThemePreference(page, 'light');
  const diagramName = await activeTabName(page);
  const diagram = (await mcp.getSession(sessionId)).diagrams.find((candidate) => candidate.name === diagramName);
  assert(diagram, `Could not resolve active syntax-test diagram ${JSON.stringify(diagramName)} from the session catalog.`);
  await ensureSourceFlyoutOpen(page);
  await replaceSource(page, MERMAID_HIGHLIGHT_BROWSER_FIXTURE);
  await waitForSource(page, MERMAID_HIGHLIGHT_BROWSER_FIXTURE);

  const readSyntax = async () => page.locator('.cm-content').evaluate((content) => {
    const source = content as HTMLElement;
    const spans = [...source.querySelectorAll<HTMLElement>('span')];
    const header = spans.find((candidate) => candidate.textContent === 'flowchart');
    const label = spans.find((candidate) => candidate.textContent === '"Label"');
    const link = spans.find((candidate) => candidate.textContent === '-->');
    return {
      bodyColor: getComputedStyle(source).color,
      header: header ? { className: header.className, color: getComputedStyle(header).color } : null,
      label: label ? { className: label.className, color: getComputedStyle(label).color } : null,
      link: link ? { className: link.className, color: getComputedStyle(link).color } : null,
    };
  });

  await expect.poll(readSyntax, { message: 'Light Mermaid source spans did not receive syntax styles.', timeout: 5_000 }).toMatchObject({
    header: { color: 'rgb(21, 89, 200)' },
    label: { color: 'rgb(25, 94, 45)' },
    link: { color: 'rgb(141, 23, 48)' },
  });

  await selectThemePreference(page, 'dark');
  await expect.poll(readSyntax, { message: 'Dark Mermaid source spans did not receive syntax styles.', timeout: 5_000 }).toMatchObject({
    header: { color: 'rgb(154, 191, 255)' },
    label: { color: 'rgb(162, 230, 178)' },
    link: { color: 'rgb(255, 184, 196)' },
  });

  await page.emulateMedia({ forcedColors: 'active' });
  await expect.poll(async () => {
    const syntax = await readSyntax();
    return Boolean(
      syntax.header?.className.length
      && syntax.label?.className.length
      && syntax.link?.className.length
      && syntax.header.color === syntax.bodyColor
      && syntax.label.color === syntax.bodyColor
      && syntax.link.color === syntax.bodyColor,
    );
  }, { message: 'Forced-colors Mermaid source spans did not resolve to CanvasText.', timeout: 5_000 }).toBe(true);
  await page.emulateMedia({ forcedColors: 'none' });
  await selectThemePreference(page, 'light');

  const editor = await ensureSourceFlyoutOpen(page);
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nB-->C');
  const expected = `${MERMAID_HIGHLIGHT_BROWSER_FIXTURE}\n  B-->C`;
  await waitForSource(page, expected);
  const selection = await editor.evaluate((content) => {
    const view = (content as HTMLElement & { cmView?: { rootView?: { view?: { state?: { doc?: { toString(): string }; selection?: { main?: { head?: number } } } } } } }).cmView?.rootView?.view;
    return { head: view?.state?.selection?.main?.head ?? null, source: view?.state?.doc?.toString() ?? null };
  });
  assert(selection.source === expected && selection.head === expected.length,
    `Incremental syntax edit changed the CodeMirror document or selection: ${JSON.stringify(selection)}.`);
  await expect.poll(async () => {
    return (await mcp.readDiagram(sessionId, diagram.id)).mermaidText;
  }, { message: 'Syntax-highlighted source did not reach the shared Yjs session.', timeout: 15_000 }).toBe(expected);
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
  await expectWorkspaceSettingsDetached(page, 'save-display-name', async () => {
    await verifiedClick(page, dialog.getByRole('button', { name: 'Save name', exact: true }), 'settings save display name');
  });
  await waitForFocusedTestId(page, SETTINGS_TRIGGER_TEST_ID, 'Saving display name');

  const reopenedAfterSave = await openWorkspaceSettings(page);
  const savedInput = reopenedAfterSave.getByRole('textbox', { name: 'Display name', exact: true });
  assert(await savedInput.inputValue() === savedName, 'Saving display name did not retain the edited value.');
  await savedInput.fill('Discarded by cancel');
  await expectWorkspaceSettingsDetached(page, 'cancel-display-name', async () => {
    await verifiedClick(page, reopenedAfterSave.getByRole('button', { name: 'Cancel', exact: true }), 'settings cancel display name');
  });

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
  await expectWorkspaceSettingsDetached(page, 'escape-display-name', async () => {
    await page.keyboard.press('Escape');
  });
  await waitForFocusedTestId(page, SETTINGS_TRIGGER_TEST_ID, 'Closing settings with Escape');

  const reopenedAfterEscape = await openWorkspaceSettings(page);
  const restoredInput = reopenedAfterEscape.getByRole('textbox', { name: 'Display name', exact: true });
  await page.waitForFunction((expected) => (document.querySelector('#workspace-display-name') as HTMLInputElement | null)?.value === expected, savedName, { timeout: 5_000 });
  assert(await restoredInput.inputValue() === savedName, 'Escaping display-name edit changed the saved value.');
  await restoredInput.fill(originalName);
  await expectWorkspaceSettingsDetached(page, 'restore-display-name', async () => {
    await verifiedClick(page, reopenedAfterEscape.getByRole('button', { name: 'Save name', exact: true }), 'restore display name after settings test');
  });

  const backwardBoundary = await openWorkspaceSettings(page);
  await waitForFocusedLocator(
    page,
    backwardBoundary.getByRole('textbox', { name: 'Display name', exact: true }),
    'Settling settings autofocus before backward boundary',
  );
  const backwardBoundaryClose = backwardBoundary.getByRole('button', { name: 'Close', exact: true });
  await backwardBoundaryClose.focus();
  await waitForFocusedLocator(page, backwardBoundaryClose, 'Selecting the first settings tab stop');
  await expectWorkspaceSettingsDetached(page, 'backward-focus-boundary', async () => {
    await page.keyboard.press('Shift+Tab');
  });
  assert(await page.evaluate(() => !document.querySelector('[data-testid="workspace-settings-dialog"]')?.contains(document.activeElement)),
    'Shift+Tab at the start of settings trapped focus in the dialog.');

  const forwardBoundary = await openWorkspaceSettings(page);
  await waitForFocusedLocator(
    page,
    forwardBoundary.getByRole('textbox', { name: 'Display name', exact: true }),
    'Settling settings autofocus before forward boundary',
  );
  const checkedTheme = forwardBoundary.locator('input[type="radio"]:checked');
  await checkedTheme.focus();
  await waitForFocusedLocator(page, checkedTheme, 'Selecting the final settings tab stop');
  await expectWorkspaceSettingsDetached(page, 'forward-focus-boundary', async () => {
    await page.keyboard.press('Tab');
  });
  assert(await page.evaluate(() => !document.querySelector('[data-testid="workspace-settings-dialog"]')?.contains(document.activeElement)),
    'Tab at the end of settings trapped focus in the dialog.');

  await openWorkspaceSettings(page);
  await expectWorkspaceSettingsDetached(page, 'outside-close-from-logo', async () => {
    await page.locator('.workspace-logo').click();
  });
  await waitForFocusedTestId(page, SETTINGS_TRIGGER_TEST_ID, 'Outside-closing settings from inert page chrome');

  await openWorkspaceSettings(page);
  const mainTab = page.getByRole('tab', { name: 'Main', exact: true });
  await expectWorkspaceSettingsDetached(page, 'outside-close-from-tab', async () => {
    await verifiedClick(page, mainTab, 'selecting a tab outside settings');
  });
  await waitForFocusedLocator(page, mainTab, 'Selecting a tab outside settings');
  assert(await trigger.evaluate((element) => document.activeElement !== element),
    'Opening an interactive control outside settings had its focus stolen by the settings trigger.');

  const canvas = page.getByRole('application', { name: 'Interactive diagram canvas', exact: true });
  await openWorkspaceSettings(page);
  await expectWorkspaceSettingsDetached(page, 'outside-close-from-canvas', async () => {
    await canvas.focus();
    await canvas.click({ position: { x: 4, y: 4 } });
  });
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
  if (label.startsWith('mobile')) {
    const toggle = page.getByRole('button', { name: 'Overlay tools', exact: true });
    const canvas = page.getByTestId('diagram-canvas');
    await assertHitTarget(page, toggle, `${label} closed overlay toggle`);
    const toggleBounds = await toggle.boundingBox();
    const controlsBounds = await page.getByTestId('canvas-controls-toolbar').boundingBox();
    assert(toggleBounds && controlsBounds
      && (toggleBounds.x + toggleBounds.width <= controlsBounds.x || controlsBounds.x + controlsBounds.width <= toggleBounds.x
        || toggleBounds.y + toggleBounds.height <= controlsBounds.y || controlsBounds.y + controlsBounds.height <= toggleBounds.y),
    `${label} closed overlay toggle overlaps the bottom canvas toolbar.`);
    await verifiedClick(page, toggle, `${label} open overlay controls`);
    const panel = page.getByLabel('Overlay scene controls', { exact: true });
    await panel.waitFor({ state: 'visible', timeout: 5_000 });
    const actionNames = ['Add overlay', 'Move right', 'Anchor first node', 'Bring front', 'Copy overlay', 'Paste overlay', 'Delete overlay', 'Undo overlay', 'Restore overlay', 'Pen', 'Highlighter', 'Erase stroke'] as const;
    for (const actionName of actionNames) {
      const action = panel.getByRole('button', { name: actionName, exact: true });
      await action.scrollIntoViewIfNeeded();
      const evidence = await action.evaluate((element) => {
        const actionBounds = element.getBoundingClientRect();
        const panelBounds = element.parentElement!.getBoundingClientRect();
        const canvasBounds = element.closest('[data-testid="diagram-canvas"]')!.getBoundingClientRect();
        const hit = document.elementFromPoint(actionBounds.left + actionBounds.width / 2, actionBounds.top + actionBounds.height / 2);
        return {
          contained: actionBounds.left >= canvasBounds.left - 0.5 && actionBounds.right <= canvasBounds.right + 0.5
            && actionBounds.top >= canvasBounds.top - 0.5 && actionBounds.bottom <= canvasBounds.bottom + 0.5
            && actionBounds.left >= panelBounds.left - 0.5 && actionBounds.right <= panelBounds.right + 0.5
            && actionBounds.top >= panelBounds.top - 0.5 && actionBounds.bottom <= panelBounds.bottom + 0.5,
          height: actionBounds.height,
          reachable: hit instanceof Node && element.contains(hit),
          width: actionBounds.width,
        };
      });
      assert(evidence.contained && evidence.reachable && evidence.height >= 44 && evidence.width >= 44,
        `${label} overlay action ${actionName} is not contained, reachable, and touch-sized: ${JSON.stringify(evidence)}.`);
    }
    const compositeExport = panel.getByLabel('Include ink in composite export', { exact: true });
    await assertHitTarget(page, compositeExport, `${label} composite ink export choice`);
    const compositeExportBounds = await compositeExport.evaluate((input) => input.parentElement?.getBoundingClientRect().toJSON());
    assert(compositeExportBounds && compositeExportBounds.width >= 44 && compositeExportBounds.height >= 44,
      `${label} composite ink export choice is not touch-sized: ${JSON.stringify(compositeExportBounds)}.`);
    assert(await compositeExport.isChecked(), `${label} did not default ink composite export to an explicit inclusion choice.`);
    const objectCount = await page.locator('[data-testid^="overlay-object-"]').count();
    const addOverlay = panel.getByRole('button', { name: 'Add overlay', exact: true });
    await addOverlay.scrollIntoViewIfNeeded();
    await verifiedClick(page, addOverlay, `${label} add overlay from bounded panel`);
    await expect(page.locator('[data-testid^="overlay-object-"]')).toHaveCount(objectCount + 1);
    await verifiedClick(page, page.getByRole('button', { name: 'Close overlay tools', exact: true }), `${label} close overlay controls`);
    await panel.waitFor({ state: 'detached', timeout: 5_000 });
    const object = page.locator('[data-testid^="overlay-object-"]').last();
    const exposedPoint = await object.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      for (let y = bounds.top + 4; y < bounds.bottom - 4; y += 4) {
        for (let x = bounds.left + 4; x < bounds.right - 4; x += 4) {
          const hit = document.elementFromPoint(x, y);
          if (hit instanceof Node && element.contains(hit)) return { x, y };
        }
      }
      return null;
    });
    assert(exposedPoint, `${label} overlay object has no exposed click point after closing controls.`);
    await page.mouse.click(exposedPoint.x, exposedPoint.y);
    await expect.poll(async () => object.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe('2px');
    await verifiedClick(page, page.getByRole('button', { name: 'Overlay tools', exact: true }), `${label} reopen overlay controls for cleanup`);
    const deleteOverlay = page.getByRole('button', { name: 'Delete overlay', exact: true });
    await deleteOverlay.scrollIntoViewIfNeeded();
    await verifiedClick(page, deleteOverlay, `${label} delete mobile overlay fixture`);
    await expect(page.locator('[data-testid^="overlay-object-"]')).toHaveCount(objectCount);
    await verifiedClick(page, page.getByRole('button', { name: 'Close overlay tools', exact: true }), `${label} close overlay controls after cleanup`);
    await assertHitTarget(page, page.getByTestId('create-diagram-tab'), `${label} tab action after overlay close`);
    await assertHitTarget(page, page.getByTestId(SETTINGS_TRIGGER_TEST_ID), `${label} semantic topbar action after overlay close`);
    await assertHitTarget(page, page.getByRole('button', { name: 'Zoom out', exact: true }), `${label} bottom toolbar action after overlay close`);
    await assertHitTarget(page, canvas, `${label} canvas after overlay close`);
  }
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

async function expectResponsiveNumericPanel(
  page: Page,
  label: "mobile-390" | "mobile-320",
  mcp: ModernMcpClient,
  mcpUrl: string,
  baseUrl: string,
  roomAccess: RoomAccess,
  sessionId: string,
  diagramName: string,
): Promise<void> {
  await resetFixedWorkspaceOrigin(page, label);
  const source = `pie showData
  title Responsive allocation
  "One" : 1
  "Two" : 2
  "Three" : 3
  "Four" : 4
  "Five" : 5
  "Six" : 6
  "Seven" : 7
  "Eight" : 8`;
  await replaceSource(page, source);
  await waitForSource(page, source);
  await waitForSemanticMode(page, "Pie · editable · form");
  await closeFlyout(page, "source");
  const panel = page.getByTestId("pie-editor-controls");
  await panel.waitFor({ state: "visible", timeout: 15_000 });
  await assertContainedInViewport(page, panel, `${label} Pie semantic panel`);
  const geometry = await panel.evaluate((element) => {
    const panelBounds = element.getBoundingClientRect();
    const canvasBounds = element
      .closest('[data-testid="diagram-canvas"]')
      ?.getBoundingClientRect();
    return {
      bottom: panelBounds.bottom,
      canvasBottom: canvasBounds?.bottom ?? -1,
      canvasTop: canvasBounds?.top ?? -1,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      top: panelBounds.top,
    };
  });
  assert(
    geometry.top >= geometry.canvasTop - 0.5 &&
      geometry.bottom <= geometry.canvasBottom + 0.5,
    `${label} Pie panel escaped the measured canvas bounds: ${JSON.stringify(geometry)}.`,
  );
  assert(
    geometry.scrollHeight > geometry.clientHeight,
    `${label} Pie panel did not provide internal scrolling: ${JSON.stringify(geometry)}.`,
  );
  const overlayToggle = page.getByRole("button", {
    name: "Overlay tools",
    exact: true,
  });
  await assertTouchTarget(
    page,
    overlayToggle,
    `${label} closed overlay toggle above numeric panel`,
  );
  const add = panel.getByRole("button", { name: "Add slice", exact: true });
  const input = panel.getByLabel("New Pie slice value");
  const showData = panel.getByLabel("Pie show data");
  await scrollErControlIntoView(showData);
  await assertTouchTarget(page, showData, `${label} Pie show-data checkbox`);
  await scrollErControlIntoView(add);
  await assertTouchTarget(page, add, `${label} Pie add-slice control`);
  await scrollErControlIntoView(input);
  await assertTouchTarget(page, input, `${label} Pie numeric input`);
  await assertTouchTarget(
    page,
    overlayToggle,
    `${label} closed overlay toggle after numeric panel scroll`,
  );
  const [toggleBounds, inputBounds, canvasBounds] = await Promise.all([
    overlayToggle.boundingBox(),
    input.boundingBox(),
    page.getByTestId("diagram-canvas").boundingBox(),
  ]);
  assert(
    toggleBounds && inputBounds && canvasBounds,
    `${label} needs overlay toggle, Pie input, and canvas bounds.`,
  );
  assert(
    toggleBounds.y >= canvasBounds.y + 6 &&
      toggleBounds.y <= canvasBounds.y + 12,
    `${label} closed overlay toggle did not use the reserved top inset: ${JSON.stringify({ canvasBounds, toggleBounds })}.`,
  );
  assert(
    toggleBounds.x + toggleBounds.width <= inputBounds.x ||
      inputBounds.x + inputBounds.width <= toggleBounds.x ||
      toggleBounds.y + toggleBounds.height <= inputBounds.y ||
      inputBounds.y + inputBounds.height <= toggleBounds.y,
    `${label} closed overlay toggle overlaps the centered Pie input: ${JSON.stringify({ inputBounds, toggleBounds })}.`,
  );
  await input.fill("-1");
  await assertAndClickBoardControl(
    page,
    add,
    `${label} invalid Pie mutation control`,
  );
  const mutationBanner = page.getByTestId("mutation-error-banner");
  await mutationBanner.waitFor({ state: "visible", timeout: 15_000 });
  await assertClosedOverlayToggleBesideError(
    page,
    mutationBanner,
    `${label} mutation-error coexistence`,
  );
  await input.fill("1");
  await assertAndClickBoardControl(
    page,
    add,
    `${label} valid Pie mutation control`,
  );
  await mutationBanner.waitFor({ state: "detached", timeout: 15_000 });
  const lastDelete = panel.getByLabel("Delete Pie slice Eight");
  await scrollErControlIntoView(lastDelete);
  await assertTouchTarget(
    page,
    lastDelete,
    `${label} Pie scrolled delete control`,
  );
  await lastDelete.focus();
  assert(
    await lastDelete.evaluate((element) => document.activeElement === element),
    `${label} Pie scrolled control was not keyboard focusable.`,
  );
  const keyboardSource = 'pie\n  title Keyboard source\n  "Saved" : 5';
  const editor = await ensureSourceFlyoutOpen(page);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  // Synthetic insertText can make y-codemirror reconcile awareness widget DOM into the document.
  await page.keyboard.type("pie");
  await page.keyboard.press("Enter");
  await page.keyboard.type("  title Keyboard source");
  await page.keyboard.press("Enter");
  await page.keyboard.type('"Saved" : 5');
  await waitForSource(page, keyboardSource);
  await closeFlyout(page, "source");
  await waitForSemanticMode(page, "Pie · editable · form");
  await replaceSource(page, RADAR_DIAGRAM_FIXTURE);
  await waitForSource(page, RADAR_DIAGRAM_FIXTURE);
  await waitForSemanticMode(page, "Radar · editable · form");
  await closeFlyout(page, "source");
  const radarPanel = page.getByTestId("radar-editor-controls");
  await assertContainedInViewport(
    page,
    radarPanel,
    `${label} Radar semantic panel`,
  );
  const showLegend = radarPanel.getByLabel("Radar show legend");
  await scrollErControlIntoView(showLegend);
  await assertTouchTarget(
    page,
    showLegend,
    `${label} Radar show-legend checkbox`,
  );
  const responsiveSankey = `sankey-beta
A,B,1
B,C,1
C,D,1
D,E,1
E,F,1
F,G,1
G,H,1
H,I,1`;
  await replaceSource(page, responsiveSankey);
  await waitForSource(page, responsiveSankey);
  await waitForSemanticMode(page, "Sankey · editable · form");
  await closeFlyout(page, "source");
  const sankeyPanel = page.getByTestId("sankey-editor-controls");
  await assertContainedInViewport(
    page,
    sankeyPanel,
    `${label} Sankey semantic panel`,
  );
  const sankeyGeometry = await sankeyPanel.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  assert(
    sankeyGeometry.scrollHeight > sankeyGeometry.clientHeight,
    `${label} Sankey panel did not provide internal scrolling: ${JSON.stringify(sankeyGeometry)}.`,
  );
  const addSankey = sankeyPanel.getByRole("button", {
    name: "Add link",
    exact: true,
  });
  const sankeyWeight = sankeyPanel.getByLabel("New Sankey link weight");
  await scrollErControlIntoView(addSankey);
  await assertTouchTarget(page, addSankey, `${label} Sankey add-link control`);
  await sankeyPanel.getByLabel("New Sankey link source").fill("I");
  await sankeyPanel.getByLabel("New Sankey link target").fill("J");
  await sankeyWeight.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("0");
  await assertAndClickBoardControl(
    page,
    addSankey,
    `${label} invalid Sankey weight`,
  );
  const sankeyBanner = page.getByTestId("mutation-error-banner");
  await sankeyBanner.waitFor({ state: "visible", timeout: 15_000 });
  await assertClosedOverlayToggleBesideError(
    page,
    sankeyBanner,
    `${label} Sankey mutation-error coexistence`,
  );
  await expect(sankeyWeight).toHaveValue("0");
  await sankeyWeight.fill("1");
  await assertAndClickBoardControl(
    page,
    addSankey,
    `${label} valid Sankey recovery`,
  );
  await sankeyBanner.waitFor({ state: "detached", timeout: 15_000 });
  const responsivePacket = `packet-beta
  0: "Bit 0"
  1: "Bit 1"
  2: "Bit 2"
  3: "Bit 3"
  4: "Bit 4"
  5: "Bit 5"
  6: "Bit 6"
  7: "Bit 7"`;
  await replaceSource(page, responsivePacket);
  await waitForSource(page, responsivePacket);
  await waitForSemanticMode(page, "Packet · editable · form");
  await closeFlyout(page, "source");
  const packetPanel = page.getByTestId("packet-editor-controls");
  await assertContainedInViewport(
    page,
    packetPanel,
    `${label} Packet semantic panel`,
  );
  const packetGeometry = await packetPanel.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  assert(
    packetGeometry.scrollHeight > packetGeometry.clientHeight,
    `${label} Packet panel did not provide internal scrolling: ${JSON.stringify(packetGeometry)}.`,
  );
  const addPacket = packetPanel.getByRole("button", {
    name: "Add field",
    exact: true,
  });
  await scrollErControlIntoView(addPacket);
  await assertTouchTarget(page, addPacket, `${label} Packet add-field control`);
  const firstPacket = packetPanel.getByRole("form", {
    name: "Packet field Bit 0 bits 0-0",
    exact: true,
  });
  const firstWidth = firstPacket.getByLabel(
    "Packet field Bit 0 bits 0-0 width",
  );
  await scrollErControlIntoView(firstWidth);
  await assertTouchTarget(page, firstWidth, `${label} Packet width control`);
  await firstWidth.fill("2");
  await assertAndClickBoardControl(
    page,
    firstPacket.getByRole("button", { name: "Save", exact: true }),
    `${label} Packet overlap rejection`,
  );
  const packetBanner = page.getByTestId("mutation-error-banner");
  await packetBanner.waitFor({ state: "visible", timeout: 15_000 });
  await assertClosedOverlayToggleBesideError(
    page,
    packetBanner,
    `${label} Packet mutation-error coexistence`,
  );
  await expect(firstWidth).toHaveValue("2");
  await firstWidth.fill("1");
  await firstPacket
    .getByLabel("Packet field Bit 0 bits 0-0 label")
    .fill("Version");
  await assertAndClickBoardControl(
    page,
    firstPacket.getByRole("button", { name: "Save", exact: true }),
    `${label} Packet valid recovery`,
  );
  await packetBanner.waitFor({ state: "detached", timeout: 15_000 });
  const lastPacketDelete = packetPanel.getByLabel(
    "Delete Packet field Bit 7 bits 7-7",
  );
  await scrollErControlIntoView(lastPacketDelete);
  await assertTouchTarget(
    page,
    lastPacketDelete,
    `${label} Packet scrolled delete control`,
  );
  await replaceSource(page, CYNEFIN_DIAGRAM_FIXTURE);
  await waitForSource(page, CYNEFIN_DIAGRAM_FIXTURE);
  await waitForSemanticMode(page, "Cynefin · editable · form");
  await closeFlyout(page, "source");
  const cynefinPanel = page.getByTestId("cynefin-editor-controls");
  await assertContainedInViewport(
    page,
    cynefinPanel,
    `${label} Cynefin semantic panel`,
  );
  const cynefinGeometry = await cynefinPanel.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  assert(
    cynefinGeometry.scrollHeight > cynefinGeometry.clientHeight,
    `${label} Cynefin panel did not provide internal scrolling: ${JSON.stringify(cynefinGeometry)}.`,
  );
  const cynefinItemLabel = cynefinPanel.getByLabel("New Cynefin item label");
  await scrollErControlIntoView(cynefinItemLabel);
  await assertTouchTarget(
    page,
    cynefinItemLabel,
    `${label} Cynefin item input`,
  );
  await cynefinItemLabel.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("Mobile item");
  await expect(cynefinItemLabel).toHaveValue("Mobile item");
  const addCynefinTransition = cynefinPanel.getByRole("button", {
    name: "Add transition",
    exact: true,
  });
  await scrollErControlIntoView(addCynefinTransition);
  await assertTouchTarget(
    page,
    addCynefinTransition,
    `${label} Cynefin add-transition control`,
  );
  const cynefinTransitionLabel = cynefinPanel.getByLabel(
    "New Cynefin transition label",
  );
  await cynefinTransitionLabel.focus();
  await page.keyboard.type("Mobile transition");
  await cynefinPanel
    .getByLabel("New Cynefin transition target")
    .selectOption("complex");
  await assertAndClickBoardControl(
    page,
    addCynefinTransition,
    `${label} Cynefin self-loop rejection`,
  );
  const cynefinBanner = page.getByTestId("mutation-error-banner");
  await cynefinBanner.waitFor({ state: "visible", timeout: 15_000 });
  await assertClosedOverlayToggleBesideError(
    page,
    cynefinBanner,
    `${label} Cynefin mutation-error coexistence`,
  );
  await expect(cynefinTransitionLabel).toHaveValue("Mobile transition");
  await cynefinPanel
    .getByLabel("New Cynefin transition target")
    .selectOption("clear");
  await assertAndClickBoardControl(
    page,
    addCynefinTransition,
    `${label} Cynefin valid recovery`,
  );
  await cynefinBanner.waitFor({ state: "detached", timeout: 15_000 });
  const mobileTransitionDelete = cynefinPanel.getByLabel(
    "Delete Cynefin transition Complex to Clear Mobile transition",
  );
  await scrollErControlIntoView(mobileTransitionDelete);
  await assertTouchTarget(
    page,
    mobileTransitionDelete,
    `${label} Cynefin scrolled delete control`,
  );
  await assertTouchTarget(
    page,
    overlayToggle,
    `${label} closed overlay toggle after Cynefin panel scroll`,
  );
  await resetFixedWorkspaceOrigin(page, `${label} Treemap`);
  const responsiveTreemap = `treemap-beta\n  "Portfolio"\n${Array.from({ length: 10 }, (_, index) => `    "Leaf ${index}": ${index + 1}`).join("\n")}`;
  await replaceSource(page, responsiveTreemap);
  await waitForSource(page, responsiveTreemap);
  await waitForSemanticMode(page, "Treemap · editable · form");
  await closeFlyout(page, "source");
  const treemapPanel = page.getByTestId("treemap-editor-controls");
  await treemapPanel.waitFor({ state: "visible", timeout: 15_000 });
  await resetFixedWorkspaceOrigin(page, `${label} Treemap visible panel`);
  await assertContainedInViewport(
    page,
    treemapPanel,
    `${label} Treemap semantic panel`,
  );
  const treemapGeometry = await treemapPanel.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  assert(
    treemapGeometry.scrollHeight > treemapGeometry.clientHeight,
    `${label} Treemap panel did not provide internal scrolling: ${JSON.stringify(treemapGeometry)}.`,
  );
  const treemapAdd = treemapPanel.getByRole("button", {
    name: "Add node",
    exact: true,
  });
  await scrollErControlIntoView(treemapAdd);
  await assertTouchTarget(
    page,
    treemapAdd,
    `${label} Treemap add-node control`,
  );
  await treemapAdd.focus();
  assert(
    await treemapAdd.evaluate((element) => document.activeElement === element),
    `${label} Treemap add node was not keyboard focusable.`,
  );
  const lastTreemapDelete = treemapForm(treemapPanel, [
    "Portfolio",
    "Leaf 9",
  ]).getByLabel(
    `Delete ${treemapControlLabel(["Portfolio", "Leaf 9"])} subtree containing 1 node`,
  );
  await scrollErControlIntoView(lastTreemapDelete);
  await assertTouchTarget(
    page,
    lastTreemapDelete,
    `${label} Treemap scrolled-last delete control`,
  );
  await treemapPanel.getByLabel("New Treemap node label").fill("Mobile");
  await treemapPanel.getByLabel("New Treemap node value").fill("11");
  await assertAndClickBoardControl(
    page,
    treemapAdd,
    `${label} Treemap real mutation`,
  );
  const treemapAdded = `${responsiveTreemap}\n    "Mobile": 11`;
  await ensureSourceFlyoutOpen(page);
  await expect
    .poll(() => canonicalSource(page), { timeout: 15_000 })
    .toBe(treemapAdded);
  await closeFlyout(page, "source");
  const leafZero = treemapForm(treemapPanel, ["Portfolio", "Leaf 0"]);
  const leafZeroValue = leafZero.getByLabel(
    `${treemapControlLabel(["Portfolio", "Leaf 0"])} value`,
  );
  await scrollErControlIntoView(leafZeroValue);
  await leafZeroValue.fill("-1");
  await assertAndClickBoardControl(
    page,
    leafZero.getByRole("button", { name: "Save", exact: true }),
    `${label} Treemap invalid numeric no-write`,
  );
  const treemapError = treemapPanel.getByRole("alert");
  const responsiveTreemapBanner = page.getByTestId("mutation-error-banner");
  await expect(treemapError).toHaveText(
    "Treemap values must be finite numbers greater than zero.",
  );
  await expect(responsiveTreemapBanner).toContainText(
    "Treemap values must be finite numbers greater than zero.",
  );
  await assertClosedOverlayToggleBesideError(
    page,
    responsiveTreemapBanner,
    `${label} Treemap mutation-error coexistence`,
  );
  await expect(leafZeroValue).toHaveValue("-1");
  await ensureSourceFlyoutOpen(page);
  await expect
    .poll(() => canonicalSource(page), { timeout: 15_000 })
    .toBe(treemapAdded);
  await closeFlyout(page, "source");
  await leafZeroValue.fill("1");
  await assertAndClickBoardControl(
    page,
    leafZero.getByRole("button", { name: "Save", exact: true }),
    `${label} Treemap recovery`,
  );
  await expect(treemapError).toHaveCount(0);
  await expect(responsiveTreemapBanner).toHaveCount(0);
  const treemapUndo = await focusCurrentDiagramCanvas(
    page,
    `${label} Treemap undo`,
  );
  await treemapUndo.press("ControlOrMeta+z");
  await ensureSourceFlyoutOpen(page);
  await expect
    .poll(() => canonicalSource(page), { timeout: 15_000 })
    .toBe(responsiveTreemap);
  await closeFlyout(page, "source");
  const advancedTreemap =
    'treemap-beta\n  "Root":::important\n    "Leaf": 1';
  await replaceSource(page, advancedTreemap);
  await waitForSource(page, advancedTreemap);
  await expect
    .poll(() => page.getByTestId("diagram-mode").textContent(), {
      timeout: 15_000,
    })
    .toBe("Treemap · source only");
  await closeFlyout(page, "source");
  await expect(treemapPanel).toHaveCount(0);
  await resetFixedWorkspaceOrigin(page, `${label} Venn`);
  const responsiveVenn = `venn-beta\n${["A", "B", "C", "D", "E", "F"].map((name, index) => `  set ${name}: ${index + 2}`).join("\n")}\n  union A, B: 1\n  union C, D: 1\n  union E, F: 1`;
  await replaceSource(page, responsiveVenn);
  await waitForSource(page, responsiveVenn);
  await waitForSemanticMode(page, "Venn · editable · form");
  await closeFlyout(page, "source");
  const vennPanel = page.getByTestId("venn-editor-controls");
  await vennPanel.waitFor({ state: "visible", timeout: 15_000 });
  await resetFixedWorkspaceOrigin(page, `${label} Venn visible panel`);
  await assertContainedInViewport(
    page,
    vennPanel,
    `${label} Venn semantic panel`,
  );
  const vennGeometry = await vennPanel.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  assert(
    vennGeometry.scrollHeight > vennGeometry.clientHeight,
    `${label} Venn panel did not provide internal scrolling: ${JSON.stringify(vennGeometry)}.`,
  );
  const vennAdd = vennPanel.getByRole("button", {
    name: "Add subset",
    exact: true,
  });
  await scrollErControlIntoView(vennAdd);
  await assertTouchTarget(page, vennAdd, `${label} Venn authored-set control`);
  await vennAdd.focus();
  assert(
    await vennAdd.evaluate((element) => document.activeElement === element),
    `${label} Venn add subset was not keyboard focusable.`,
  );
  const lastVennDelete = vennPanel
    .getByRole("form", { name: "Venn overlap E and F", exact: true })
    .getByLabel("Delete Venn overlap E and F");
  await scrollErControlIntoView(lastVennDelete);
  await assertTouchTarget(
    page,
    lastVennDelete,
    `${label} Venn scrolled-last delete control`,
  );
  await vennPanel.getByLabel("New Venn set id").fill("G");
  await vennPanel.getByLabel("New Venn subset value").fill("8");
  await assertAndClickBoardControl(
    page,
    vennAdd,
    `${label} Venn real authored-set mutation`,
  );
  const vennAdded = responsiveVenn.replace(
    "  union A, B: 1",
    "  set G: 8\n  union A, B: 1",
  );
  await ensureSourceFlyoutOpen(page);
  await expect
    .poll(() => canonicalSource(page), { timeout: 15_000 })
    .toBe(vennAdded);
  await closeFlyout(page, "source");
  await vennPanel.getByLabel("New Venn set id").fill("H");
  const newVennValue = vennPanel.getByLabel("New Venn subset value");
  await newVennValue.fill("-1");
  await assertAndClickBoardControl(
    page,
    vennAdd,
    `${label} Venn invalid numeric no-write`,
  );
  const vennError = vennPanel.getByRole("alert");
  const responsiveVennBanner = page.getByTestId("mutation-error-banner");
  await expect(vennError).toHaveText(
    "Venn base set values must be finite numbers greater than zero.",
  );
  await expect(responsiveVennBanner).toContainText(
    "Venn base set values must be finite numbers greater than zero.",
  );
  await assertClosedOverlayToggleBesideError(
    page,
    responsiveVennBanner,
    `${label} Venn mutation-error coexistence`,
  );
  await expect(newVennValue).toHaveValue("-1");
  await ensureSourceFlyoutOpen(page);
  await expect
    .poll(() => canonicalSource(page), { timeout: 15_000 })
    .toBe(vennAdded);
  await closeFlyout(page, "source");
  await newVennValue.fill("9");
  await assertAndClickBoardControl(page, vennAdd, `${label} Venn recovery`);
  await expect(vennError).toHaveCount(0);
  await expect(responsiveVennBanner).toHaveCount(0);
  const vennUndo = await focusCurrentDiagramCanvas(page, `${label} Venn undo`);
  await vennUndo.press("ControlOrMeta+z");
  await vennUndo.press("ControlOrMeta+z");
  await ensureSourceFlyoutOpen(page);
  await expect
    .poll(() => canonicalSource(page), { timeout: 15_000 })
    .toBe(responsiveVenn);
  await closeFlyout(page, "source");
  const advancedVenn = "venn-beta\n  title Advanced\n  set A: 1";
  await replaceSource(page, advancedVenn);
  await waitForSource(page, advancedVenn);
  await expect
    .poll(() => page.getByTestId("diagram-mode").textContent(), {
      timeout: 15_000,
    })
    .toBe("Venn · source only");
  await closeFlyout(page, "source");
  await expect(vennPanel).toHaveCount(0);
  await assertTouchTarget(
    page,
    overlayToggle,
    `${label} closed overlay toggle after Treemap/Venn panel scroll`,
  );
  const responsiveWardley = `${WARDLEY_DIAGRAM_FIXTURE}\n${Array.from({ length: 8 }, (_, index) => `  note "Mobile note ${index}" [0.${index + 1}, 0.5]`).join('\n')}`;
  await replaceSource(page, responsiveWardley);
  await waitForSource(page, responsiveWardley);
  await waitForSemanticMode(page, 'Wardley · editable · form');
  await closeFlyout(page, 'source');
  const wardleyPanel = page.getByTestId('wardley-editor-controls');
  await wardleyPanel.waitFor({ state: 'visible', timeout: 15_000 });
  await resetFixedWorkspaceOrigin(page, `${label} Wardley visible panel`);
  await assertContainedInViewport(page, wardleyPanel, `${label} Wardley semantic panel`);
  const wardleyGeometry = await wardleyPanel.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  assert(wardleyGeometry.scrollHeight > wardleyGeometry.clientHeight,
    `${label} Wardley panel did not provide internal scrolling: ${JSON.stringify(wardleyGeometry)}.`);
  const wardleyAdd = wardleyPanel.getByRole('button', { name: 'Add node', exact: true });
  await scrollErControlIntoView(wardleyAdd);
  await assertTouchTarget(page, wardleyAdd, `${label} Wardley add-node control`);
  await wardleyPanel.getByLabel('New Wardley node name').fill('Mobile component');
  const wardleyVisibility = wardleyPanel.getByLabel('New Wardley node visibility');
  await wardleyVisibility.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('-1');
  await assertAndClickBoardControl(page, wardleyAdd, `${label} Wardley invalid coordinate no-write`);
  const wardleyError = wardleyPanel.getByRole('alert');
  const wardleyBanner = page.getByTestId('mutation-error-banner');
  await expect(wardleyError).toContainText('from 0 to 1');
  await expect(wardleyVisibility).toHaveValue('-1');
  await assertClosedOverlayToggleBesideError(page, wardleyBanner, `${label} Wardley mutation-error coexistence`);
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { message: `${label} Wardley invalid no-write`, timeout: 15_000 }).toBe(responsiveWardley);
  await closeFlyout(page, 'source');
  await wardleyVisibility.fill('0.5');
  await assertAndClickBoardControl(page, wardleyAdd, `${label} Wardley valid recovery`);
  await expect(wardleyError).toHaveCount(0);
  await expect(wardleyBanner).toHaveCount(0);
  const wardleyWithMobile = `${responsiveWardley}\n  component "Mobile component" [0.5, 0.5]`;
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { message: `${label} Wardley exact add source`, timeout: 15_000 }).toBe(wardleyWithMobile);
  await closeFlyout(page, 'source');
  const lastWardleyDelete = wardleyPanel.getByLabel('Delete Wardley component Mobile component');
  await scrollErControlIntoView(lastWardleyDelete);
  await assertTouchTarget(page, lastWardleyDelete, `${label} Wardley scrolled-last delete control`);
  const wardleyUndo = await focusCurrentDiagramCanvas(page, `${label} Wardley undo`);
  await wardleyUndo.press('ControlOrMeta+z');
  await ensureSourceFlyoutOpen(page);
  await expect.poll(() => canonicalSource(page), { message: `${label} Wardley undo source`, timeout: 15_000 }).toBe(responsiveWardley);
  await closeFlyout(page, 'source');
  const advancedWardley = 'wardley-beta\n  title Advanced\n  component A [0.5, 0.5]';
  await replaceSource(page, advancedWardley);
  await waitForSource(page, advancedWardley);
  await expect.poll(() => page.getByTestId('diagram-mode').textContent(), { message: `${label} Wardley advanced fallback`, timeout: 15_000 }).toBe('Wardley · source only');
  await closeFlyout(page, 'source');
  await expect(wardleyPanel).toHaveCount(0);
  await expectRemoteWardleyDraftReconciliation(page, mcp, mcpUrl, baseUrl, roomAccess, sessionId, label);
  await expectRemoteTreemapVennDraftReconciliation(
    page,
    mcp,
    mcpUrl,
    baseUrl,
    roomAccess,
    sessionId,
    label,
  );
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForSource(page, FLOWCHART_FIXTURE);
  await closeFlyout(page, "source");
  await waitForCanvas(page, "flowchart");
}

async function waitForPhoneLayout(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
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
  if (label.startsWith('mobile-390') || label.startsWith('mobile-320')) {
    await assertClosedOverlayToggleBesideError(page, banner, `${label} parse-error coexistence`);
  }
}

async function assertClosedOverlayToggleBesideError(page: Page, banner: Locator, label: string): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Overlay tools', exact: true });
  await assertTouchTarget(page, toggle, `${label} closed overlay toggle`);
  await assertContainedInViewport(page, toggle, `${label} closed overlay toggle`);
  await assertContainedInViewport(page, banner, `${label} banner`);
  const [toggleBounds, bannerBounds, canvasBounds] = await Promise.all([
    toggle.boundingBox(), banner.boundingBox(), page.getByTestId('diagram-canvas').boundingBox(),
  ]);
  assert(toggleBounds && bannerBounds && canvasBounds, `${label} needs toggle, banner, and canvas bounds.`);
  if ((page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) <= 420) {
    assert(toggleBounds.y >= canvasBounds.y + 6 && toggleBounds.y <= canvasBounds.y + 12,
      `${label} toggle left the reserved top inset: ${JSON.stringify({ canvasBounds, toggleBounds })}.`);
  }
  assert(toggleBounds.x + toggleBounds.width <= bannerBounds.x || bannerBounds.x + bannerBounds.width <= toggleBounds.x
    || toggleBounds.y + toggleBounds.height <= bannerBounds.y || bannerBounds.y + bannerBounds.height <= toggleBounds.y,
  `${label} toggle overlaps its error banner: ${JSON.stringify({ bannerBounds, toggleBounds })}.`);
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
    const forbiddenSelector = 'a, button, input, label, select, textarea, form, [contenteditable="true"], [role="button"], [data-canvas-pan-exclusion="true"], [data-subgraph-drag-target="true"], [data-testid*="toolbar"], .react-flow__node, .react-flow__edge, .react-flow__handle';
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
    const currentSvgBeforePreview = await page.locator('.diagram-canvas-svg > svg').innerHTML();

    await ensureFlyout(page, 'activity');
    await assertCurrentHistoryCardEdges(page);
    const historicalItem = historyItem(page, historical.revision.id);
    await historicalItem.waitFor({ state: 'visible', timeout: 15_000 });
    await verifiedClick(page, historicalItem.getByRole('button', { name: 'Preview', exact: true }), 'desktop immutable history preview');
    await page.getByTestId('history-preview-notice').waitFor({ state: 'visible', timeout: 15_000 });
    await expect.poll(async () => page.locator('.diagram-canvas-svg > svg').innerHTML(), {
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
    const restoredActivityCountBeforeRestore = observer.snapshot(target.id).activity
      .filter((event) => event.action === 'restored' && event.restoredFromRevisionId === historical.revision.id).length;
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
    await observer.waitFor(
      (current) => {
        const activity = current.snapshot(target.id).activity;
        return activity.filter((event) => event.action === 'restored'
          && event.restoredFromRevisionId === historical.revision.id).length === restoredActivityCountBeforeRestore + 1;
      },
      'the linked restore activity in Yjs',
    );
    const activityAfterRestore = observer.snapshot(target.id).activity;
    assert(activityAfterRestore.filter((event) => event.action === 'restored'
      && event.restoredFromRevisionId === historical.revision.id).length === restoredActivityCountBeforeRestore + 1,
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
  if (slice !== undefined && slice !== 'history' && slice !== 'cynefin-history') {
    throw new Error(`Unsupported ARIELCHARTS_E2E_SLICE=${JSON.stringify(slice)}. Expected "history", "cynefin-history", or no slice.`);
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

      if (slice === 'cynefin-history') {
        const { page: cynefinPage } = await browser.newPage(DESKTOP_VIEWPORT);
        await visitWorkspace(cynefinPage, baseUrl, sessionId, room.roomKey);
        await replaceSource(cynefinPage, FLOWCHART_FIXTURE);
        await waitForSource(cynefinPage, FLOWCHART_FIXTURE);
        await waitForCanvas(cynefinPage, 'flowchart');
        await closeFlyout(cynefinPage, 'source');
        await expectCynefinSemanticEditor(cynefinPage);
        record(results, 'Cynefin form exposes fixed-domain item and transition lifecycles, deterministic boundaries, recovery, undo/redo, and advanced-source fallback');
        return;
      }

      const { page } = await browser.newPage(DESKTOP_VIEWPORT);
      await visitWorkspace(page, baseUrl, sessionId, room.roomKey);
        await expectAgentConnectionModal(page, mcpUrl, sessionId, roomAccess.cookie, 'in-memory');
        record(results, 'fragment-derived room key exposes a copyable MCP bearer prompt');
        await expectThemeContract(page);
        record(results, 'system, light, and dark media resolution plus persistence');
        await expectMermaidSyntaxHighlighting(page, mcp, sessionId);
        record(results, 'Mermaid source tokens render in light, dark, and forced colors while incremental edits preserve selection and Yjs source');
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
      await expectOverlaySceneFoundation(page, diagramName);
      record(results, 'durable overlay create, move, order, clipboard, delete, undo, history restore, tab isolation, and SVG/React Flow camera placement');
      await selectTabByName(page, diagramName);
      await saveScreenshot(page, 'issue-14-blank');
      await expectTemplateDiagramCreation(page);
      record(results, 'flowchart and API sequence templates render, rename, edit, and remain ordinary diagrams');
      await expectErSemanticEditor(page);
      record(results, 'ER semantic form has hit-tested entity controls, source-safe writes, stable anchors, and no generic graph editor');
      await expectRelationshipArchitectureEditors(page);
      record(results, 'Class, State, and Requirement semantic forms expose hit-tested source-safe controls, preserve anchors/camera, and fail closed for nested state');
      await expectTemporalSemanticEditors(page);
      record(results, 'Journey, Gantt, and Timeline semantic forms expose hit-tested source-backed controls and fail closed for advanced source');
      await expectBoardSemanticEditors(page);
      record(results, 'GitGraph, Event Modeling, and Kanban semantic forms expose hit-tested source-backed controls and fail closed for invalid history/source');
      await expectHierarchySemanticEditors(page);
      record(results, 'Mindmap, TreeView, and Ishikawa semantic forms expose hit-tested hierarchy controls and fail closed for advanced source');
      await expectRailroadSemanticEditor(page);
      record(results, 'Railroad IR, EBNF, ABNF, and PEG forms expose source-backed production controls and fail closed for advanced grammar');
      await expectNumericSemanticEditors(page);
      record(results, 'Pie, Quadrant, XY, and Radar forms expose validated source-backed numeric controls and fail closed for advanced syntax');
      await expectFlowSemanticEditors(page);
      record(results, 'Sankey and Packet forms expose CSV-safe weighted links, atomic node renames, contiguous reflow, recovery, and advanced-source fallback');
      await expectCynefinSemanticEditor(page);
      record(results, 'Cynefin form exposes fixed-domain item and transition lifecycles, deterministic boundaries, recovery, undo/redo, and advanced-source fallback');
      await expectTreemapAndVennSemanticEditors(page, mcp, mcpUrl, baseUrl, roomAccess, sessionId);
      record(results, 'Treemap and Venn forms expose collision-safe subtree controls, authored defaults, exact errors, MCP-isolated remote drafts, deterministic themes, and source-only fallback');
      await expectWardleySemanticEditor(page, mcp, mcpUrl, baseUrl, roomAccess, sessionId);
      record(results, 'Wardley form exposes source-safe nodes, links, flows, evolves, notes, pipelines, validated coordinates, MCP-isolated drafts, deterministic themes, and source-only fallback');
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
          if (label === 'mobile-390' || label === 'mobile-320') {
            await expectResponsiveNumericPanel(responsivePage, label, mcp, mcpUrl, baseUrl, roomAccess, sessionId, diagramName);
            record(results, `${label} Treemap/Venn/Wardley exact source, rejection isolation, undo, MCP remote drafts, source-only fallback, scrolled-last 44px targets, and overlay coexistence`);
          }
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
