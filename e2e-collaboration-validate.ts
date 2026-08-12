import { existsSync } from 'node:fs';
import { chromium, expect, type Browser, type CDPSession, type Locator, type Page } from '@playwright/test';
import { WebSocket as NodeWebSocket } from 'ws';
import {
  assertNoPageErrors,
  assertNoReactFlowError015,
  collectReactFlowDiagnostics,
  getReactFlowNodePosition,
  waitForReactFlowNodePositionMatch,
  waitForReactFlowNodePositionMovement,
} from './e2e/support/react-flow';
import { ModernMcpClient, postModernMcp, type Diagram } from './e2e/support/mcp';
import { withOwnedServices, type E2eEndpoints } from './e2e/support/owned-services';
import {
  createRoom,
  exchangeRoomAccess,
  getRoomAccess,
  roomShareUrl,
  rotateRoomAccess,
  type RoomCredentials,
} from './e2e/support/room-access';
import { getYjsSourceLayoutSignature, openYjsSessionObserver, type YjsSessionObserver } from './e2e/support/yjs-session';

const BASE_FLOWCHART = `flowchart LR
  Browser[Browser] --> Gateway[Gateway]
  Gateway --> Service[Service]
  Service --> Database[(Database)]`;
const LOCAL_VIEW_FLOWCHART = `flowchart TD
  Local[Local view] --> Scratch[Scratch]`;
const HUMAN_EDGE = '  Browser --> Audit[Audit]';
const AGENT_EDGE = '  Gateway --> Worker[Worker]';
const PENDING_PRUNE_FLOWCHART = `flowchart LR
  A[Disposable] --> B[Bridge]
  B --> C[Keep]`;
const PENDING_PRUNE_REMOVED = `flowchart LR
  B[Bridge] --> C[Keep]`;
const NEGATIVE_OBSERVATION_WINDOW_MS = 300;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function writeDiagram(
  mcp: ModernMcpClient,
  sessionId: string,
  diagramId: string,
  mermaidText: string,
  expectedRevision: string,
) {
  return mcp.tool('writeDiagram', {
    sessionId,
    diagramId,
    mermaidText,
    expectedRevision,
    actorName: 'E2E agent',
    actorType: 'agent',
    detail: 'Merged concurrent browser edit',
  });
}

function sourceEditor(page: Page): Locator {
  return page.locator('.cm-content');
}

async function ensureSourceFlyoutOpen(page: Page): Promise<Locator> {
  const toggle = page.getByTestId('source-flyout-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  const editor = sourceEditor(page);
  await editor.waitFor({ state: 'visible', timeout: 15_000 });
  return editor;
}

async function closeSourceFlyout(page: Page): Promise<void> {
  const toggle = page.getByTestId('source-flyout-toggle');
  if (await toggle.getAttribute('aria-expanded') === 'true') {
    await toggle.click();
    await page.getByTestId('source-flyout').waitFor({ state: 'detached', timeout: 15_000 });
  }
}

async function expectCollaborativeAnnotations(pageA: Page, pageB: Page): Promise<void> {
  const sourceA = await canonicalPageSource(pageA); const sourceB = await canonicalPageSource(pageB);
  await Promise.all([
    verifiedOverlayClick(pageA, 'Overlay tools'),
    verifiedOverlayClick(pageB, 'Overlay tools'),
  ]);
  await verifiedOverlayClick(pageA, 'Add overlay');
  await verifiedOverlayClick(pageA, 'Rectangle');
  await expect(pageB.locator('[data-testid^="overlay-object-"]')).toHaveCount(2);
  await verifiedOverlayClick(pageA, 'Ellipse');
  await expect(pageB.locator('[data-testid^="overlay-object-"]')).toHaveCount(3);
  const overlayList = pageA.getByLabel('ArielCharts overlay list', { exact: true });
  await overlayList.getByRole('button', { name: /shape\.rectangle:/u }).click();
  await overlayList.getByRole('button', { name: /shape\.ellipse:/u }).click({ modifiers: ['Control'] });
  await verifiedOverlayClick(pageA, 'Frame selection');
  await expect(pageB.locator('[data-testid^="overlay-object-"]')).toHaveCount(4);
  const frameInPalette = overlayList.locator('ul').first().locator('li > button').last();
  await frameInPalette.scrollIntoViewIfNeeded();
  await frameInPalette.click(); await verifiedOverlayClick(pageA, 'Lock frame');
  await expect(pageA.getByRole('button', { name: 'Move right', exact: true })).toHaveCount(0);
  await verifiedOverlayClick(pageA, 'Unlock frame');
  const excludeFrameMembers = pageA.getByRole('button', { name: 'Exclude frame members from composite export', exact: true });
  await expect(excludeFrameMembers).toBeEnabled();
  await verifiedOverlayClick(pageA, 'Exclude frame members from composite export');
  await expect(pageA.getByRole('button', { name: 'Include frame members in composite export', exact: true })).toBeVisible();
  await Promise.all([verifiedOverlayClick(pageA, 'Close overlay tools'), verifiedOverlayClick(pageB, 'Close overlay tools')]);
  await Promise.all([verifiedOverlayClick(pageA, 'Overlay tools'), verifiedOverlayClick(pageB, 'Overlay tools')]);
  const textListA = pageA.getByLabel('ArielCharts overlay list', { exact: true }).getByRole('button', { name: /^Text:/u });
  const textListB = pageB.getByLabel('ArielCharts overlay list', { exact: true }).getByRole('button', { name: /^Text:/u });
  await Promise.all([expect(textListA).toHaveCount(1), expect(textListB).toHaveCount(1)]);
  await Promise.all([textListA.scrollIntoViewIfNeeded(), textListB.scrollIntoViewIfNeeded()]);
  await Promise.all([textListA.click(), textListB.click()]);
  await Promise.all([verifiedOverlayClick(pageA, 'Close overlay tools'), verifiedOverlayClick(pageB, 'Close overlay tools')]);
  const selectedTextA = pageA.locator('[data-testid^="overlay-object-"][data-selected="true"]');
  const selectedTextB = pageB.locator('[data-testid^="overlay-object-"][data-selected="true"]');
  await Promise.all([expect(selectedTextA).toHaveCount(1), expect(selectedTextB).toHaveCount(1)]);
  await Promise.all([selectedTextA.press('Enter'), selectedTextB.press('Enter')]);
  const notesA = pageA.locator('textarea[aria-label="Free text contents"]');
  const notesB = pageB.locator('textarea[aria-label="Free text contents"]');
  await Promise.all([notesA.first().waitFor({ state: 'visible' }), notesB.first().waitFor({ state: 'visible' })]);
  await notesA.first().fill('shared');
  await expect(notesB.first()).toHaveValue('shared');
  await notesA.first().dispatchEvent('compositionstart');
  await notesA.first().evaluate((element, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(element, value); element.dispatchEvent(new InputEvent('input', { bubbles: true, data: '漢', inputType: 'insertCompositionText', isComposing: true }));
  }, 'shared漢');
  await notesB.first().press('Home'); await notesB.first().pressSequentially('peer ');
  await notesA.first().dispatchEvent('compositionend', { data: '漢' });
  await expect.poll(async () => notesA.first().inputValue()).toContain('peer ');
  await expect.poll(async () => notesB.first().inputValue()).toContain('漢');
  await verifiedOverlayClick(pageB, 'Overlay tools'); await verifiedOverlayClick(pageB, 'Add sticky note');
  await expect(pageA.locator('[data-testid^="overlay-object-"]')).toHaveCount(5);
  await verifiedOverlayClick(pageA, 'Overlay tools');
  const stickyListA = pageA.getByLabel('ArielCharts overlay list', { exact: true }).getByRole('button', { name: /^Sticky note:/u });
  const stickyListB = pageB.getByLabel('ArielCharts overlay list', { exact: true }).getByRole('button', { name: /^Sticky note:/u });
  await Promise.all([expect(stickyListA).toHaveCount(1), expect(stickyListB).toHaveCount(1)]);
  await Promise.all([stickyListA.scrollIntoViewIfNeeded(), stickyListB.scrollIntoViewIfNeeded()]);
  await Promise.all([stickyListA.click(), stickyListB.click()]);
  await Promise.all([verifiedOverlayClick(pageA, 'Close overlay tools'), verifiedOverlayClick(pageB, 'Close overlay tools')]);
  const selectedStickyA = pageA.locator('[data-testid^="overlay-object-"][data-selected="true"]');
  const selectedStickyB = pageB.locator('[data-testid^="overlay-object-"][data-selected="true"]');
  await Promise.all([expect(selectedStickyA).toHaveCount(1), expect(selectedStickyB).toHaveCount(1)]);
  await Promise.all([selectedStickyA.press('Enter'), selectedStickyB.press('Enter')]);
  const stickyA = pageA.locator('textarea[aria-label="Sticky note contents"]');
  const stickyB = pageB.locator('textarea[aria-label="Sticky note contents"]');
  await Promise.all([stickyA.waitFor({ state: 'visible' }), stickyB.waitFor({ state: 'visible' })]);
  await stickyB.fill('different note'); await expect(stickyA).toHaveValue('different note');
  await stickyA.blur();
  await verifiedOverlayClick(pageA, 'Overlay tools');
  await verifiedOverlayClick(pageA, 'Add overlay');
  await expect(pageB.locator('[data-testid^="overlay-object-"]')).toHaveCount(6);
  const undoText = pageA.getByLabel('ArielCharts overlay list', { exact: true }).getByRole('button', { name: /^Text:/u }).last();
  await undoText.click();
  await verifiedOverlayClick(pageA, 'Close overlay tools');
  const undoObject = pageA.locator('[data-testid^="overlay-object-"][data-selected="true"]');
  await expect(undoObject).toHaveCount(1);
  await undoObject.focus();
  const beforeMove = await undoObject.getAttribute('data-world-x');
  await undoObject.press('ArrowRight');
  await expect.poll(() => undoObject.getAttribute('data-world-x')).not.toBe(beforeMove);
  const movedX = await undoObject.getAttribute('data-world-x');
  await undoObject.press('ControlOrMeta+z');
  await expect.poll(() => undoObject.getAttribute('data-world-x')).toBe(beforeMove);
  await undoObject.press('ControlOrMeta+Shift+z');
  await expect.poll(() => undoObject.getAttribute('data-world-x')).toBe(movedX);
  await undoObject.press('Delete');
  await expect(pageB.locator('[data-testid^="overlay-object-"]')).toHaveCount(5);
  await pageA.getByTestId('diagram-canvas').focus();
  await pageA.keyboard.press('ControlOrMeta+z');
  await expect(pageB.locator('[data-testid^="overlay-object-"]')).toHaveCount(6);
  await pageA.keyboard.press('ControlOrMeta+y');
  await expect(pageB.locator('[data-testid^="overlay-object-"]')).toHaveCount(5);
  const afterSourceA = await canonicalPageSource(pageA); const afterSourceB = await canonicalPageSource(pageB);
  assert(afterSourceA === sourceA && afterSourceB === sourceB && sourceA === sourceB,
    `Collaborative annotation edits changed byte-identical Mermaid source: ${JSON.stringify({ sourceA, sourceB, afterSourceA, afterSourceB })}`);
}

/** The canvas owns one local-human chronological history across Mermaid and overlays. */
async function expectUnifiedCanvasHistory(pageA: Page, pageB: Page): Promise<void> {
  const canvasA = pageA.getByTestId('diagram-canvas');
  const sourceBefore = await canonicalPageSource(pageA);
  const initialOverlayCount = await pageA.locator('[data-testid^="overlay-object-"]').count();

  // draw → node move → draw → semantic canvas source replacement
  await verifiedOverlayClick(pageA, 'Overlay tools');
  await verifiedOverlayClick(pageA, 'Add overlay');
  await expect(pageB.locator('[data-testid^="overlay-object-"]')).toHaveCount(initialOverlayCount + 1);
  await verifiedOverlayClick(pageA, 'Close overlay tools');

  const nodeId = await nodeIdAt(pageA, 0);
  const nodeBefore = await getReactFlowNodePosition(nodeById(pageA, nodeId), 'History fixture node was missing.');
  await nudgeNode(pageA, nodeById(pageA, nodeId), 56, 28);
  await waitForReactFlowNodePositionMovement(pageA, nodeId, nodeBefore);
  const nodeMoved = await getReactFlowNodePosition(nodeById(pageA, nodeId), 'History fixture node disappeared after move.');
  await waitForReactFlowNodePositionMatch(pageB, nodeId, nodeMoved);

  await verifiedOverlayClick(pageA, 'Overlay tools');
  await verifiedOverlayClick(pageA, 'Rectangle');
  await expect(pageB.locator('[data-testid^="overlay-object-"]')).toHaveCount(initialOverlayCount + 2);
  await verifiedOverlayClick(pageA, 'Close overlay tools');

  await pageA.getByRole('button', { name: 'Add node to Mermaid text', exact: true }).click();
  await expect.poll(() => canonicalPageSource(pageA)).not.toBe(sourceBefore);
  const canvasSource = await canonicalPageSource(pageA);
  await waitForSource(pageB, canvasSource);

  await canvasA.focus();
  await pageA.keyboard.press('ControlOrMeta+z');
  await waitForSource(pageA, sourceBefore);
  await waitForSource(pageB, sourceBefore);
  await canvasA.focus();
  await pageA.keyboard.press('ControlOrMeta+z');
  await expect(pageB.locator('[data-testid^="overlay-object-"]')).toHaveCount(initialOverlayCount + 1);
  await canvasA.focus();
  await pageA.keyboard.press('ControlOrMeta+z');
  await waitForReactFlowNodePositionMovement(pageA, nodeId, nodeMoved);
  const nodeUndone = await getReactFlowNodePosition(nodeById(pageA, nodeId), 'History fixture node disappeared after undo.');
  await waitForReactFlowNodePositionMatch(pageB, nodeId, nodeUndone);
  await canvasA.focus();
  await pageA.keyboard.press('ControlOrMeta+z');
  await expect(pageB.locator('[data-testid^="overlay-object-"]')).toHaveCount(initialOverlayCount);

  await pageA.keyboard.press('ControlOrMeta+y');
  await canvasA.focus();
  await pageA.keyboard.press('ControlOrMeta+y');
  await waitForReactFlowNodePositionMatch(pageA, nodeId, nodeMoved);
  await canvasA.focus();
  await pageA.keyboard.press('ControlOrMeta+y');
  await expect(pageB.locator('[data-testid^="overlay-object-"]')).toHaveCount(initialOverlayCount + 2);
  await canvasA.focus();
  await pageA.keyboard.press('ControlOrMeta+y');
  await waitForSource(pageA, canvasSource);

  // Source focus is owned by CodeMirror, not the canvas journal.
  const editor = await ensureSourceFlyoutOpen(pageA);
  await editor.click();
  await pageA.keyboard.press('Control+End');
  await pageA.keyboard.insertText(' ');
  await expect.poll(() => sourceEditorValue(editor)).not.toBe(canvasSource);
  await pageA.keyboard.press('ControlOrMeta+z');
  await waitForSource(pageA, canvasSource);
  await waitForSource(pageB, canvasSource);
  await closeSourceFlyout(pageA);

  // A peer's same-node update invalidates only that top local command. The
  // concise status is announced and the following shortcut reaches the older,
  // unrelated local draw without clobbering the peer.
  const safeCount = await pageA.locator('[data-testid^="overlay-object-"]').count();
  await verifiedOverlayClick(pageA, 'Overlay tools');
  await verifiedOverlayClick(pageA, 'Add overlay');
  await verifiedOverlayClick(pageA, 'Close overlay tools');
  await expect(pageB.locator('[data-testid^="overlay-object-"]')).toHaveCount(safeCount + 1);
  const beforeLocalMove = await getReactFlowNodePosition(nodeById(pageA, nodeId), 'Stale-history node was missing.');
  await nudgeNode(pageA, nodeById(pageA, nodeId), 44, 18);
  await waitForReactFlowNodePositionMovement(pageA, nodeId, beforeLocalMove);
  const localMove = await getReactFlowNodePosition(nodeById(pageA, nodeId), 'Stale-history local move was missing.');
  await waitForReactFlowNodePositionMatch(pageB, nodeId, localMove);
  await nudgeNode(pageB, nodeById(pageB, nodeId), -72, 31);
  await waitForReactFlowNodePositionMovement(pageB, nodeId, localMove);
  const peerMove = await getReactFlowNodePosition(nodeById(pageB, nodeId), 'Peer stale-history move was missing.');
  await waitForReactFlowNodePositionMatch(pageA, nodeId, peerMove);
  await canvasA.focus();
  await pageA.keyboard.press('ControlOrMeta+z');
  await expect(pageA.getByTestId('canvas-history-status')).toHaveText('Could not undo — this item changed since your edit.');
  await waitForReactFlowNodePositionMatch(pageA, nodeId, peerMove);
  await pageA.keyboard.press('ControlOrMeta+z');
  await expect(pageB.locator('[data-testid^="overlay-object-"]')).toHaveCount(safeCount);
  // This helper is an isolated canvas-history fixture. Return its semantic
  // source command to the collaboration suite baseline; the peer's later
  // same-node move remains untouched and is intentionally not rolled back.
  await canvasA.focus();
  await pageA.keyboard.press('ControlOrMeta+z');
  await waitForSource(pageA, sourceBefore);
  await waitForSource(pageB, sourceBefore);
  // The stale-peer drag intentionally selected the node in B. A real blank
  // pane click clears that local-only selection before the next presence case.
  const paneB = pageB.locator('.react-flow__pane');
  await paneB.click({ position: { x: 12, y: 12 } });
  await expect(pageB.locator('.react-flow__node.selected')).toHaveCount(0);
}

async function expectCollaborativeInk(
  pageA: Page,
  pageB: Page,
  cdpA: CDPSession,
): Promise<void> {
  const inkFrames: Array<{ clock: number; sequence: number }> = [];
  await cdpA.send('Network.enable');
  const onFrameSent = (event: { response: { payloadData: string } }) => {
    // Awareness payloads carry a compact binary envelope with one JSON state
    // string. Keep only numeric transport facts; never log canvas content.
    const payload = Buffer.from(event.response.payloadData, 'base64').toString('utf8');
    const matches = [...payload.matchAll(/"ink_preview":\{"active":true,"sequence":(\d+)/gu)];
    for (const match of matches) inkFrames.push({ clock: -1, sequence: Number(match[1]) });
  };
  cdpA.on('Network.webSocketFrameSent', onFrameSent);
  const sourceBefore = await canonicalPageSource(pageA);
  const canvas = pageA.getByTestId('diagram-canvas');
  const canvasBox = await boxOf(canvas, 'Ink canvas was missing.');
  const enable = async (page: Page, tool: 'Pen' | 'Highlighter' | 'Erase stroke') => {
    await verifiedOverlayClick(page, 'Overlay tools');
    await verifiedOverlayClick(page, tool);
    await verifiedOverlayClick(page, 'Close overlay tools');
  };
  await enable(pageA, 'Pen');
  const surfaceA = pageA.getByTestId('ink-drawing-surface');
  await surfaceA.waitFor({ state: 'visible', timeout: 15_000 });
  await pageA.mouse.move(canvasBox.x + 180, canvasBox.y + 180); await pageA.mouse.down();
  await pageA.mouse.move(canvasBox.x + 280, canvasBox.y + 230, { steps: 4 });
  // Presence is deliberately coalesced; give one later input event a chance to
  // publish the lossy preview rather than relying on a durable final stroke.
  // Page A owns a virtual browser clock, so advance that clock instead of
  // sleeping against wall time and leaving preview coalescing frozen.
  await pageA.clock.fastForward(150);
  await pageA.mouse.move(canvasBox.x + 292, canvasBox.y + 238);
  const remotePreview = pageB.locator('[data-testid^="ink-preview-"]');
  try {
    await remotePreview.waitFor({ state: 'visible', timeout: 15_000 });
  } catch (error) {
    throw new Error(`Remote ink preview did not arrive; structural frames=${JSON.stringify(inkFrames)}`, { cause: error });
  } finally {
    cdpA.off('Network.webSocketFrameSent', onFrameSent);
  }
  await pageA.mouse.up();
  await remotePreview.waitFor({ state: 'detached', timeout: 15_000 });
  await Promise.all([
    expect(pageA.locator('[data-testid^="ink-stroke-"]')).toHaveCount(1),
    expect(pageB.locator('[data-testid^="ink-stroke-"]')).toHaveCount(1),
  ]);

  await enable(pageA, 'Highlighter');
  // CDP produces a browser-routed stylus gesture. The first stroke above is
  // ordinary mouse input; this verifies the highlighter path without relying
  // on a synthetic React event's pointer-capture semantics.
  await cdpA.send('Input.dispatchMouseEvent', { button: 'left', buttons: 1, pointerType: 'pen', type: 'mousePressed', x: canvasBox.x + 220, y: canvasBox.y + 280 });
  await cdpA.send('Input.dispatchMouseEvent', { button: 'left', buttons: 1, pointerType: 'pen', type: 'mouseMoved', x: canvasBox.x + 320, y: canvasBox.y + 320 });
  await cdpA.send('Input.dispatchMouseEvent', { button: 'left', buttons: 0, pointerType: 'pen', type: 'mouseReleased', x: canvasBox.x + 380, y: canvasBox.y + 330 });
  await Promise.all([
    expect(pageA.locator('[data-testid^="ink-stroke-"]')).toHaveCount(2),
    expect(pageB.locator('[data-testid^="ink-stroke-"]')).toHaveCount(2),
  ]);
  // A real browser touch route must remain a drawing gesture while the ink
  // surface is active; it must not fall through to canvas pan/zoom handling.
  await cdpA.send('Input.dispatchTouchEvent', { touchPoints: [{ id: 93, x: canvasBox.x + 250, y: canvasBox.y + 360 }], type: 'touchStart' });
  await cdpA.send('Input.dispatchTouchEvent', { touchPoints: [{ id: 93, x: canvasBox.x + 340, y: canvasBox.y + 390 }], type: 'touchMove' });
  await cdpA.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
  await Promise.all([
    expect(pageA.locator('[data-testid^="ink-stroke-"]')).toHaveCount(3),
    expect(pageB.locator('[data-testid^="ink-stroke-"]')).toHaveCount(3),
  ]);
  const orderA = await pageA.locator('[data-testid^="ink-stroke-"]').evaluateAll((items) => items.map((item) => item.getAttribute('data-testid')));
  const orderB = await pageB.locator('[data-testid^="ink-stroke-"]').evaluateAll((items) => items.map((item) => item.getAttribute('data-testid')));
  assert(JSON.stringify(orderA) === JSON.stringify(orderB), `Finalized ink did not retain a stable converged order: ${JSON.stringify({ orderA, orderB })}`);
  const firstId = orderA[0]?.replace('ink-stroke-', ''); assert(firstId, 'Finalized ink did not expose a durable overlay id.');
  await verifiedOverlayClick(pageA, 'Overlay tools'); await verifiedOverlayClick(pageA, 'Highlighter');
  const firstObject = pageA.getByTestId(`overlay-object-${firstId}`);
  const beforeMove = await firstObject.getAttribute('data-world-x'); await firstObject.click();
  await verifiedOverlayClick(pageA, 'Move right');
  await expect.poll(() => firstObject.getAttribute('data-world-x')).not.toBe(beforeMove);
  // Deliberately separate the independent move and delete undo units.
  await pageA.waitForTimeout(550);
  await verifiedOverlayClick(pageA, 'Delete overlay'); await expect(pageB.locator('[data-testid^="ink-stroke-"]')).toHaveCount(2);
  await verifiedOverlayClick(pageA, 'Undo overlay'); await expect(pageB.locator('[data-testid^="ink-stroke-"]')).toHaveCount(3);
  await verifiedOverlayClick(pageA, 'Erase stroke'); await verifiedOverlayClick(pageA, 'Close overlay tools');
  const eraseBox = await boxOf(firstObject, 'Ink object was missing for whole-stroke eraser.');
  await pageA.mouse.click(eraseBox.x + eraseBox.width / 2, eraseBox.y + eraseBox.height / 2);
  await expect(pageB.locator('[data-testid^="ink-stroke-"]')).toHaveCount(2);
  await verifiedOverlayClick(pageA, 'Overlay tools'); await verifiedOverlayClick(pageA, 'Erase stroke'); await verifiedOverlayClick(pageA, 'Close overlay tools');
  const sourceAfter = await canonicalPageSource(pageA);
  assert(sourceAfter === sourceBefore, 'Ink creation, move, delete, undo, or erase changed Mermaid source bytes.');
}

async function verifiedOverlayClick(page: Page, name: string): Promise<void> {
  const button = page.getByRole('button', { name, exact: true });
  await button.scrollIntoViewIfNeeded(); await button.click();
}

async function canonicalPageSource(page: Page): Promise<string> {
  const editor = await ensureSourceFlyoutOpen(page);
  const value = await sourceEditorValue(editor);
  await closeSourceFlyout(page);
  return value;
}

async function sourceEditorValue(editor: Locator): Promise<string> {
  return editor.evaluate((element) => [...element.querySelectorAll('.cm-line')].map((line) => {
    const copy = line.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('.cm-ySelectionCaret, .cm-widgetBuffer').forEach((widget) => { widget.remove(); });
    return copy.textContent ?? '';
  }).join('\n'));
}

async function replaceSource(page: Page, source: string): Promise<void> {
  const editor = await ensureSourceFlyoutOpen(page);
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(source);
}

async function waitForSource(page: Page, expected: string): Promise<void> {
  const toggle = page.getByTestId('source-flyout-toggle');
  const wasOpen = await toggle.getAttribute('aria-expanded') === 'true';
  const editor = await ensureSourceFlyoutOpen(page);
  await expect.poll(() => sourceEditorValue(editor)).toBe(expected);
  if (!wasOpen) await closeSourceFlyout(page);
}

async function waitForFlowchart(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    return document.querySelector('[data-testid="diagram-mode"]')?.textContent?.includes('Flowchart · editable')
      && document.querySelectorAll('.react-flow__node').length >= 2;
  }, undefined, { timeout: 15_000 });
}

async function waitForSourceFlyoutSync(page: Page): Promise<void> {
  await page.getByTestId('connection-status-badge').filter({ hasText: /^synced$/i }).waitFor({ state: 'visible', timeout: 15_000 });
}

async function waitForMainTabActive(page: Page): Promise<void> {
  const mainTab = page.getByRole('tab', { name: 'Main', exact: true });
  await mainTab.waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForFunction(() => {
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
    return tabs.some((tab) => tab.textContent?.trim() === 'Main' && tab.getAttribute('aria-selected') === 'true');
  }, undefined, { timeout: 15_000 });
}

async function getInternalParticipantName(page: Page): Promise<string> {
  const name = await page.evaluate(() => {
    const identityJson = window.localStorage.getItem('arielcharts.identity.v1');
    const tabId = window.sessionStorage.getItem('arielcharts.tab.v1');
    if (!identityJson || !tabId) return null;
    try {
      const identity = JSON.parse(identityJson) as { name?: unknown };
      return typeof identity.name === 'string' && identity.name.length > 0
        ? `${identity.name}-${tabId}`
        : null;
    } catch {
      return null;
    }
  });
  assert(name, 'Browser did not expose its internal awareness participant identity.');
  return name;
}

function remoteCursorForParticipant(page: Page, participantName: string): Locator {
  return page.locator(
    `[data-testid^="remote-canvas-cursor-"][data-participant-name=${JSON.stringify(participantName)}]`,
  );
}

function remoteLaserForParticipant(page: Page, participantName: string): Locator {
  return page.locator(
    `[data-testid^="laser-pointer-"][data-participant-name=${JSON.stringify(participantName)}]`,
  ).last();
}

function transformedLayer(page: Page): Locator {
  return page.locator('.diagram-canvas-svg').locator('..');
}

async function getActiveTabId(page: Page): Promise<string | null> {
  return page.locator('[role="tab"][aria-selected="true"]').getAttribute('id');
}

async function selectTabByName(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name, exact: true }).click();
  await page.getByRole('tab', { name, exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForFunction((tabName) => {
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
    return tabs.some((tab) => tab.getAttribute('aria-selected') === 'true' && tab.textContent?.trim() === tabName);
  }, name, { timeout: 15_000 });
}

async function nodeIdAt(page: Page, index: number): Promise<string> {
  const id = await page.locator('.react-flow__node').nth(index).getAttribute('data-id');
  assert(id, `Missing React Flow data-id at node index ${index}.`);
  return id;
}

function nodeById(page: Page, id: string): Locator {
  return page.locator(`.react-flow__node[data-id=${JSON.stringify(id)}]`);
}

async function boxOf(locator: Locator, message: string) {
  const box = await locator.boundingBox();
  assert(box, message);
  return box;
}

async function nudgeNode(page: Page, locator: Locator, dx: number, dy: number, hold = false): Promise<void> {
  const box = await boxOf(locator, 'Node has no drag bounds.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  if (!hold) await page.mouse.up();
}

async function advanceClockUntilNodePresence(
  page: Page,
  nodeId: string,
  expectedCount: number,
  maximumAdvanceMs: number,
  stepMs = 10,
): Promise<number> {
  let elapsed = 0;
  while (await nodeById(page, nodeId).count() !== expectedCount) {
    assert(elapsed < maximumAdvanceMs,
      `Node ${nodeId} did not reach count ${expectedCount} within ${maximumAdvanceMs}ms of controlled clock time.`);
    const advance = Math.min(stepMs, maximumAdvanceMs - elapsed);
    await page.clock.runFor(advance);
    elapsed += advance;
  }
  return elapsed;
}

function positionsMatch(
  left: { x: number; y: number },
  right: { x: number; y: number },
  tolerance = 2,
): boolean {
  return Math.abs(left.x - right.x) <= tolerance && Math.abs(left.y - right.y) <= tolerance;
}

function diagramStateUrl(serverUrl: string, sessionId: string): string {
  return new URL(`/api/sessions/${encodeURIComponent(sessionId)}/diagrams/main`, serverUrl).toString();
}

async function diagramStateResponse(
  serverUrl: string,
  origin: string,
  sessionId: string,
  cookie?: string,
): Promise<Response> {
  return fetch(diagramStateUrl(serverUrl, sessionId), {
    headers: { ...(cookie ? { cookie } : {}), origin },
  });
}

async function waitForBrowserSocketRevocation(page: Page, label: string): Promise<void> {
  await page.waitForFunction(() => {
    const state = document.querySelector('[data-testid="connection-status-badge"]')?.textContent?.trim().toLowerCase();
    return Boolean(state && state !== 'synced');
  }, undefined, { timeout: 15_000 }).catch(() => {
    throw new Error(`${label} remained synced after room key rotation.`);
  });
}

async function openAuthorizedWebsocket(
  serverUrl: string,
  origin: string,
  sessionId: string,
  cookie: string,
): Promise<{ closed: Promise<void>; terminate: () => void }> {
  const websocketUrl = new URL(`/ws/${encodeURIComponent(sessionId)}`, serverUrl);
  websocketUrl.protocol = websocketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new NodeWebSocket(websocketUrl, { headers: { cookie, origin } });
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.terminate();
        reject(new Error(`Authorized room WebSocket did not open: ${websocketUrl}`));
      }, 5_000);
      socket.once('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  } catch (error) {
    socket.terminate();
    throw error;
  }
  return { closed, terminate: () => socket.terminate() };
}

async function expectRejectedWebsocket(
  serverUrl: string,
  origin: string,
  sessionId: string,
  cookie?: string,
): Promise<void> {
  const websocketUrl = new URL(`/ws/${encodeURIComponent(sessionId)}`, serverUrl);
  websocketUrl.protocol = websocketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  await new Promise<void>((resolve, reject) => {
    const socket = new NodeWebSocket(websocketUrl, { headers: { ...(cookie ? { cookie } : {}), origin } });
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error(`Rejected room WebSocket stayed open: ${websocketUrl}`));
    }, 5_000);
    socket.on('open', () => {
      clearTimeout(timeout);
      socket.terminate();
      reject(new Error(`Rejected room WebSocket unexpectedly opened: ${websocketUrl}`));
    });
    socket.on('close', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.on('error', () => undefined);
  });
}

async function expectLockedRoomDoesNotMount(
  browser: Browser,
  baseUrl: string,
  serverUrl: string,
  room: RoomCredentials,
  invalidKey = false,
): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const websocketUrls: string[] = [];
  const stateRequests: string[] = [];
  page.on('websocket', (socket) => { websocketUrls.push(socket.url()); });
  page.on('request', (request) => {
    if (request.url().startsWith(`${serverUrl}/api/sessions/${encodeURIComponent(room.sessionId)}/`)) {
      stateRequests.push(request.url());
    }
  });
  try {
    const target = invalidKey
      ? roomShareUrl(baseUrl, { ...room, roomKey: 'invalid-room-key' })
      : new URL(`/s/${encodeURIComponent(room.sessionId)}`, baseUrl).toString();
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.getByRole('heading', { name: 'Enter the room key', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    if (invalidKey) {
      await page.locator('#room-key-error').waitFor({ state: 'visible', timeout: 15_000 });
    }
    await page.waitForTimeout(300);
    assert(await page.getByTestId('canvas-first-workspace').count() === 0,
      `${invalidKey ? 'Invalid' : 'Bare'} room URL mounted the workspace.`);
    assert(websocketUrls.length === 0,
      `${invalidKey ? 'Invalid' : 'Bare'} room URL opened a WebSocket: ${JSON.stringify(websocketUrls)}.`);
    assert(stateRequests.length === 0,
      `${invalidKey ? 'Invalid' : 'Bare'} room URL requested diagram state: ${JSON.stringify(stateRequests)}.`);
  } finally {
    await context.close();
  }
}

async function expectProtectedRoomAccess(browser: Browser, endpoints: E2eEndpoints): Promise<void> {
  const { baseUrl, mcpUrl, serverUrl } = endpoints;
  const room = await createRoom(serverUrl, baseUrl);
  const shareUrl = roomShareUrl(baseUrl, room);
  const parsedShareUrl = new URL(shareUrl);
  assert(parsedShareUrl.search === '' && parsedShareUrl.hash.startsWith('#roomKey='),
    `Room share link leaked its key outside the fragment: ${shareUrl}.`);
  assert((await diagramStateResponse(serverUrl, baseUrl, room.sessionId)).status === 401,
    'Unauthenticated diagram state access was not denied.');
  await expectRejectedWebsocket(serverUrl, baseUrl, room.sessionId);
  await expectLockedRoomDoesNotMount(browser, baseUrl, serverUrl, room);
  await expectLockedRoomDoesNotMount(browser, baseUrl, serverUrl, room, true);

  const browserA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const browserB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pageA = await browserA.newPage();
  const pageB = await browserB.newPage();
  let activeSocket: Awaited<ReturnType<typeof openAuthorizedWebsocket>> | null = null;
  try {
    await Promise.all([
      pageA.goto(shareUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }),
      pageB.goto(shareUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }),
    ]);
    await Promise.all([
      pageA.getByTestId('canvas-first-workspace').waitFor({ state: 'visible', timeout: 15_000 }),
      pageB.getByTestId('canvas-first-workspace').waitFor({ state: 'visible', timeout: 15_000 }),
      ensureSourceFlyoutOpen(pageA),
      ensureSourceFlyoutOpen(pageB),
    ]);
    await Promise.all([
      pageA.getByTestId('connection-status-badge').filter({ hasText: /^synced$/i }).waitFor({ state: 'visible', timeout: 15_000 }),
      pageB.getByTestId('connection-status-badge').filter({ hasText: /^synced$/i }).waitFor({ state: 'visible', timeout: 15_000 }),
    ]);
    assert(await pageA.evaluate(() => window.location.hash === '') && await pageB.evaluate(() => window.location.hash === ''),
      'Successful fragment room-key exchange did not clear the browser URL hash.');

    const roomAccess = await exchangeRoomAccess(serverUrl, baseUrl, room);
    const mcp = new ModernMcpClient(mcpUrl, baseUrl, room);
    const session = await mcp.getSession(room.sessionId);
    assert(session.diagrams.some((diagram) => diagram.id === 'main'),
      'Authorized MCP client did not receive the protected room main diagram.');

    const roomB = await createRoom(serverUrl, baseUrl);
    assert((await getRoomAccess(serverUrl, baseUrl, roomB.sessionId, roomAccess.cookie)).status === 401,
      'Room-A cookie accessed room B.');
    assert((await diagramStateResponse(serverUrl, baseUrl, roomB.sessionId, roomAccess.cookie)).status === 401,
      'Room-A cookie accessed room-B diagram state.');
    const foreignMcp = await postModernMcp(mcpUrl, baseUrl, room, 'getSession', { sessionId: roomB.sessionId });
    const foreignMcpPayload = await foreignMcp.json().catch(() => null) as {
      error?: unknown;
      result?: { isError?: boolean };
    } | null;
    assert(!foreignMcp.ok || Boolean(foreignMcpPayload?.error) || foreignMcpPayload?.result?.isError === true,
      `Room-A MCP bearer accessed room B: status=${foreignMcp.status} body=${JSON.stringify(foreignMcpPayload)}.`);

    const socket = await openAuthorizedWebsocket(serverUrl, baseUrl, room.sessionId, roomAccess.cookie);
    activeSocket = socket;
    const rotated = await rotateRoomAccess(serverUrl, baseUrl, roomAccess);
    await Promise.all([
      socket.closed,
      waitForBrowserSocketRevocation(pageA, 'authorized browser A socket'),
      waitForBrowserSocketRevocation(pageB, 'authorized browser B socket'),
    ]);
    assert((await getRoomAccess(serverUrl, baseUrl, room.sessionId, roomAccess.cookie)).status === 401,
      'Pre-rotation browser cookie remained valid.');
    assert((await diagramStateResponse(serverUrl, baseUrl, room.sessionId, roomAccess.cookie)).status === 401,
      'Pre-rotation browser cookie still read diagram state.');
    await expectRejectedWebsocket(serverUrl, baseUrl, room.sessionId, roomAccess.cookie);
    const revokedMcp = await postModernMcp(mcpUrl, baseUrl, room, 'getSession', { sessionId: room.sessionId });
    assert(revokedMcp.status === 401, `Pre-rotation MCP bearer returned ${revokedMcp.status}, not 401.`);
    assert((await getRoomAccess(serverUrl, baseUrl, room.sessionId, rotated.cookie)).status === 204,
      'Replacement rotation cookie was not accepted.');
    const replacementMcp = new ModernMcpClient(mcpUrl, baseUrl, rotated);
    await replacementMcp.getSession(room.sessionId);

    const replacementContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const replacementPage = await replacementContext.newPage();
    try {
      await replacementPage.goto(roomShareUrl(baseUrl, rotated), { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await replacementPage.getByTestId('canvas-first-workspace').waitFor({ state: 'visible', timeout: 15_000 });
      assert(await replacementPage.evaluate(() => window.location.hash === ''),
        'Replacement room key did not clear from the browser URL after exchange.');
    } finally {
      await replacementContext.close();
    }
  } finally {
    activeSocket?.terminate();
    await Promise.all([browserB.close(), browserA.close()]);
  }
}

async function validateCollaboration({ baseUrl, mcpUrl, serverUrl }: E2eEndpoints): Promise<void> {
  const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({ executablePath: chromiumPath, headless: true });
  try {
  const browserA = await browser.newContext({ hasTouch: true, viewport: { width: 1400, height: 900 } });
  const browserB = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const pageA = await browserA.newPage();
  const pageB = await browserB.newPage();
  const cdpA = await browserA.newCDPSession(pageA);
  await pageA.clock.install({ time: Date.now() });
  const diagnosticsA = collectReactFlowDiagnostics(pageA);
  const diagnosticsB = collectReactFlowDiagnostics(pageB);
  const room = await createRoom(serverUrl, baseUrl);
  const roomAccess = await exchangeRoomAccess(serverUrl, baseUrl, room);
  const sessionId = room.sessionId;
  const mcp = new ModernMcpClient(mcpUrl, baseUrl, room);

    await expectProtectedRoomAccess(browser, { baseUrl, mcpUrl, serverUrl });
    await Promise.all([
      pageA.goto(roomShareUrl(baseUrl, room), { waitUntil: 'domcontentloaded', timeout: 30_000 }),
      pageB.goto(roomShareUrl(baseUrl, room), { waitUntil: 'domcontentloaded', timeout: 30_000 }),
    ]);
    await Promise.all([
      pageA.getByTestId('canvas-first-workspace').waitFor({ state: 'visible', timeout: 15_000 }),
      pageB.getByTestId('canvas-first-workspace').waitFor({ state: 'visible', timeout: 15_000 }),
    ]);
    await Promise.all([waitForMainTabActive(pageA), waitForMainTabActive(pageB)]);

    await Promise.all([ensureSourceFlyoutOpen(pageA), ensureSourceFlyoutOpen(pageB)]);
    await Promise.all([waitForSourceFlyoutSync(pageA), waitForSourceFlyoutSync(pageB)]);
    await replaceSource(pageA, BASE_FLOWCHART);
    await waitForFlowchart(pageA);
    await waitForSource(pageB, BASE_FLOWCHART);
    await waitForFlowchart(pageB);
    await closeSourceFlyout(pageB);

    const initial = await mcp.getSession(sessionId);
    const main = initial.diagrams.find((diagram) => diagram.id === 'main');
    assert(main, 'Modern MCP getSession did not expose the named main diagram.');
    const staleRevision = (await mcp.readDiagram(sessionId, main.id)).revision;
    const localView = await mcp.createDiagramWithLatestRevision(sessionId, 'Local view', LOCAL_VIEW_FLOWCHART);

    await pageB.getByRole('tab', { name: 'Local view', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    await selectTabByName(pageB, 'Local view');
    await waitForFlowchart(pageB);
    const localNode = pageB.locator('.react-flow__node').first();
    await localNode.click();
    const selectedNodeId = await nodeIdAt(pageB, 0);
    const selectedBeforeRemote = (await nodeById(pageB, selectedNodeId).getAttribute('class'))?.includes('selected') === true;
    assert(selectedBeforeRemote, 'Selecting the local-view node did not produce a React Flow selected node.');
    await pageB.getByRole('button', { name: 'Connect nodes' }).click();
    await pageB.getByText('click target node [esc cancel]', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    await pageB.getByRole('button', { name: 'Zoom in' }).click();
    const localTabBeforeRemote = await getActiveTabId(pageB);
    const localTransformBeforeRemote = await transformedLayer(pageB).getAttribute('style');
    const sourceOpenBeforeRemote = await pageA.getByTestId('source-flyout-toggle').getAttribute('aria-expanded');
    const sourceClosedBeforeRemote = await pageB.getByTestId('source-flyout-toggle').getAttribute('aria-expanded');

    await selectTabByName(pageA, 'Main');
    await ensureSourceFlyoutOpen(pageA);
    await replaceSource(pageA, `${BASE_FLOWCHART}\n${HUMAN_EDGE}`);
    await waitForSource(pageA, `${BASE_FLOWCHART}\n${HUMAN_EDGE}`);
    await pageA.waitForTimeout(250);
    const afterHuman = await mcp.readDiagram(sessionId, main.id);
    assert(afterHuman.revision !== staleRevision, 'Browser source write did not advance the MCP diagram revision.');
    assert(afterHuman.mermaidText.includes(HUMAN_EDGE.trim()), 'MCP re-read did not observe the browser edit.');

    const staleWrite = await writeDiagram(mcp, sessionId, main.id, `${BASE_FLOWCHART}\n${AGENT_EDGE}`, staleRevision);
    const staleText = `${staleWrite.result?.content?.map((item) => item.text ?? '').join('\n') ?? ''}\n${staleWrite.error?.message ?? ''}`;
    const staleRejected = staleWrite.result?.isError === true && /stale diagram revision/i.test(staleText);
    assert(staleRejected, `Stale modern MCP write was not rejected: ${staleText}`);

    const reread = await mcp.readDiagram(sessionId, main.id);
    const mergedSource = `${reread.mermaidText}\n${AGENT_EDGE}`;
    const retriedWrite = await writeDiagram(mcp, sessionId, main.id, mergedSource, reread.revision);
    const merged = mcp.expectContent<{ diagram: Diagram }>(retriedWrite, 'writeDiagram').diagram;
    assert(merged.mermaidText === mergedSource, 'MCP retry did not write the exact merged source.');

    await waitForSource(pageA, mergedSource);
    const activeTabPreserved = await getActiveTabId(pageB) === localTabBeforeRemote;
    const sourceFlyoutsPreserved = await pageA.getByTestId('source-flyout-toggle').getAttribute('aria-expanded') === sourceOpenBeforeRemote
      && await pageB.getByTestId('source-flyout-toggle').getAttribute('aria-expanded') === sourceClosedBeforeRemote;
    const localConnectModePreserved = await pageB.getByText('click target node [esc cancel]', { exact: true }).count() === 1;
    const localSelectionPreserved = (await nodeById(pageB, selectedNodeId).getAttribute('class'))?.includes('selected') === true;
    const localCameraPreserved = await transformedLayer(pageB).getAttribute('style') === localTransformBeforeRemote;
    assert(activeTabPreserved && sourceFlyoutsPreserved && localConnectModePreserved && localSelectionPreserved && localCameraPreserved,
      `Remote MCP update took over browser-local state: tab=${activeTabPreserved} flyouts=${sourceFlyoutsPreserved} mode=${localConnectModePreserved} selection=${localSelectionPreserved} camera=${localCameraPreserved}`);
    await pageB.screenshot({ path: '/tmp/arielcharts-collaboration-local-state.png' });

    await selectTabByName(pageB, 'Main');
    await ensureSourceFlyoutOpen(pageB);
    await waitForSource(pageB, mergedSource);
    await closeSourceFlyout(pageB);
    await closeSourceFlyout(pageA);
    await Promise.all([waitForFlowchart(pageA), waitForFlowchart(pageB)]);
    await expectCollaborativeAnnotations(pageA, pageB);
    await expectUnifiedCanvasHistory(pageA, pageB);
    await expectCollaborativeInk(pageA, pageB, cdpA);

    const pageAParticipantName = await getInternalParticipantName(pageA);
    const pageARemoteCursor = remoteCursorForParticipant(pageB, pageAParticipantName);
    const presenceNodeId = await nodeIdAt(pageA, 0);
    const presenceNode = nodeById(pageA, presenceNodeId);
    const presenceNodeBox = await boxOf(presenceNode, 'Presence fixture node was missing.');
    await pageA.mouse.move(presenceNodeBox.x + (presenceNodeBox.width / 2), presenceNodeBox.y + (presenceNodeBox.height / 2));
    await presenceNode.click();
    await pageARemoteCursor.waitFor({ state: 'visible', timeout: 15_000 });
    await pageB.getByTestId(`remote-node-selection-${presenceNodeId}`).waitFor({ state: 'visible', timeout: 15_000 });
    const remoteSelectionDoesNotTakeLocalSelection = !((await nodeById(pageB, presenceNodeId).getAttribute('class'))?.includes('selected'));
    assert(remoteSelectionDoesNotTakeLocalSelection, 'Remote canvas selection took over the receiving browser selection state.');
    await pageB.screenshot({ path: '/tmp/arielcharts-canvas-presence.png' });

    const laserObserver = await openYjsSessionObserver(mcpUrl, sessionId, { cookie: roomAccess.cookie, origin: baseUrl });
    await pageA.waitForTimeout(1_100);
    const durableBeforeLaser = await mcp.readDiagram(sessionId, main.id);
    const sessionBeforeLaser = await mcp.getSession(sessionId);
    const yjsBeforeLaser = laserObserver.snapshot(main.id);
    const cameraABeforeLaser = await transformedLayer(pageA).getAttribute('style');
    await pageB.getByRole('button', { name: 'Zoom in' }).click();
    const cameraBBeforeLaser = await transformedLayer(pageB).getAttribute('style');
    await pageA.getByRole('button', { name: 'Laser pointer', exact: true }).click();
    const canvasA = pageA.getByTestId('diagram-canvas');
    const canvasABox = await boxOf(canvasA, 'Laser canvas was missing.');
    await pageA.mouse.move(canvasABox.x + 220, canvasABox.y + 180);
    await pageA.mouse.down();
    await pageA.mouse.move(canvasABox.x + 300, canvasABox.y + 240, { steps: 4 });
    const remoteLaser = remoteLaserForParticipant(pageB, pageAParticipantName);
    await remoteLaser.waitFor({ state: 'visible', timeout: 15_000 });
    const remoteLaserBeforeZoom = await boxOf(remoteLaser, 'Remote laser had no bounds before receiver zoom.');
    await pageB.getByRole('button', { name: 'Zoom in' }).click();
    const remoteLaserAfterZoom = await boxOf(remoteLaser, 'Remote laser had no bounds after receiver zoom.');
    assert(!positionsMatch(remoteLaserBeforeZoom, remoteLaserAfterZoom),
      'World-coordinate laser did not reproject when the receiving browser camera changed.');
    await pageB.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    const accessibleLaserStyle = await remoteLaser.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, transition: style.transitionDuration };
    });
    assert(accessibleLaserStyle.transition === '0s', 'Reduced-motion laser retained a fade transition.');
    await pageB.screenshot({ path: '/tmp/arielcharts-collaboration-laser.png' });
    await pageB.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference' });
    await pageA.keyboard.press('Escape');
    await pageA.mouse.up();
    await remoteLaser.waitFor({ state: 'detached', timeout: 15_000 });
    assert(await pageA.getByRole('button', { name: 'Laser pointer', exact: true }).count() === 1,
      'Escape did not exit the laser tool.');

    const startLaserSample = async () => {
      await pageA.getByRole('button', { name: 'Laser pointer', exact: true }).click();
      await pageA.mouse.move(canvasABox.x + 220, canvasABox.y + 180);
      await pageA.mouse.down();
      await pageA.mouse.move(canvasABox.x + 240, canvasABox.y + 200);
      await remoteLaser.waitFor({ state: 'visible', timeout: 15_000 });
    };
    const expectLaserExit = async (exit: () => Promise<void>, label: string, options: { releaseBeforeExit?: boolean; restoresCanvasLaserControl?: boolean } = {}) => {
      if (options.releaseBeforeExit) {
        await pageA.mouse.up();
        await remoteLaser.waitFor({ state: 'detached', timeout: 15_000 });
      }
      await exit();
      await pageA.mouse.up();
      await remoteLaser.waitFor({ state: 'detached', timeout: 15_000 });
      assert(await pageA.locator('[data-testid="laser-pointer-local"]').count() === 0,
        `${label} left a local laser sample active.`);
      if (options.restoresCanvasLaserControl !== false) await expect(pageA.getByRole('button', { name: 'Laser pointer', exact: true })).toHaveCount(1);
    };
    await startLaserSample();
    await expectLaserExit(() => pageA.getByRole('button', { name: 'Exit laser pointer', exact: true }).click(), 'Laser toolbar exit', { releaseBeforeExit: true });
    await startLaserSample();
    await expectLaserExit(async () => { await canvasA.focus(); await pageA.keyboard.press('l'); }, 'Laser L exit');
    await startLaserSample();
    await expectLaserExit(async () => { await canvasA.focus(); await pageA.keyboard.press('v'); }, 'Laser V exit');
    for (const overlayTool of ['Select overlay tool', 'Pen', 'Highlighter', 'Erase stroke'] as const) {
      await startLaserSample();
      if (overlayTool !== 'Select overlay tool') {
        // A physical toolbar click ends the held pointer first; prove the sample
        // reached the peer, then verify that the released canvas can open the
        // palette before activating its mutually-exclusive drawing tool.
        await pageA.mouse.up();
        await remoteLaser.waitFor({ state: 'detached', timeout: 15_000 });
        await verifiedOverlayClick(pageA, 'Overlay tools');
        await expect(pageA.getByRole('button', { name: 'Close overlay tools', exact: true })).toHaveCount(1);
        await expect(pageA.getByLabel('More overlay tools', { exact: true })).toBeVisible();
      }
      await expectLaserExit(() => pageA.getByRole('button', { name: overlayTool, exact: true }).click(), `Laser ${overlayTool} exit`, { restoresCanvasLaserControl: false });
      if (overlayTool !== 'Select overlay tool') await verifiedOverlayClick(pageA, 'Close overlay tools');
      await canvasA.focus();
      await pageA.keyboard.press('v');
      await expect(pageA.getByRole('button', { name: 'Laser pointer', exact: true })).toHaveCount(1);
    }

    await pageA.getByRole('button', { name: 'Laser pointer', exact: true }).click();
    await cdpA.send('Input.dispatchMouseEvent', { button: 'left', buttons: 1, pointerType: 'pen', type: 'mousePressed', x: canvasABox.x + 180, y: canvasABox.y + 140 });
    await cdpA.send('Input.dispatchMouseEvent', { button: 'left', buttons: 1, pointerType: 'pen', type: 'mouseMoved', x: canvasABox.x + 200, y: canvasABox.y + 160 });
    await remoteLaserForParticipant(pageB, pageAParticipantName).waitFor({ state: 'visible', timeout: 15_000 });
    await cdpA.send('Input.dispatchMouseEvent', { button: 'left', buttons: 0, pointerType: 'pen', type: 'mouseReleased', x: canvasABox.x + 200, y: canvasABox.y + 160 });
    await remoteLaserForParticipant(pageB, pageAParticipantName).waitFor({ state: 'detached', timeout: 15_000 });
    await cdpA.send('Input.dispatchTouchEvent', { touchPoints: [{ id: 92, x: canvasABox.x + 160, y: canvasABox.y + 120 }], type: 'touchStart' });
    await cdpA.send('Input.dispatchTouchEvent', { touchPoints: [{ id: 92, x: canvasABox.x + 190, y: canvasABox.y + 150 }], type: 'touchMove' });
    await remoteLaserForParticipant(pageB, pageAParticipantName).waitFor({ state: 'visible', timeout: 15_000 });
    await cdpA.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
    await remoteLaserForParticipant(pageB, pageAParticipantName).waitFor({ state: 'detached', timeout: 15_000 });
    await canvasA.focus();
    await pageA.keyboard.press('Escape');
    await pageA.getByRole('button', { name: 'Laser pointer', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    assert(await transformedLayer(pageA).getAttribute('style') === cameraABeforeLaser,
      'Laser gestures changed the presenting browser camera.');
    assert(await transformedLayer(pageB).getAttribute('style') !== cameraBBeforeLaser,
      'Receiver camera evidence did not record its independent zoom.');
    const yjsAfterLaserGestures = laserObserver.snapshot(main.id);
    assert(JSON.stringify(yjsAfterLaserGestures) === JSON.stringify(yjsBeforeLaser),
      'Laser gestures changed live Yjs source/layout/activity history.');

    await pageA.getByRole('button', { name: 'Laser pointer', exact: true }).click();
    await pageA.mouse.move(canvasABox.x + 240, canvasABox.y + 200);
    await pageA.mouse.down();
    await remoteLaserForParticipant(pageB, pageAParticipantName).waitFor({ state: 'visible', timeout: 15_000 });
    await pageA.evaluate(() => {
      [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
        .find((tab) => tab.textContent?.trim() === 'Local view')?.click();
    });
    await remoteLaserForParticipant(pageB, pageAParticipantName).waitFor({ state: 'detached', timeout: 15_000 });
    await pageA.mouse.up();
    await selectTabByName(pageA, 'Main');
    await waitForFlowchart(pageA);

    const reconnectedCanvas = pageA.getByTestId('diagram-canvas');
    const reconnectedCanvasBox = await boxOf(reconnectedCanvas, 'Reconnect laser canvas was missing.');
    await pageA.getByRole('button', { name: 'Laser pointer', exact: true }).click();
    await pageA.mouse.move(reconnectedCanvasBox.x + 260, reconnectedCanvasBox.y + 210);
    await pageA.mouse.down();
    await remoteLaserForParticipant(pageB, pageAParticipantName).waitFor({ state: 'visible', timeout: 15_000 });
    await pageA.reload({ waitUntil: 'domcontentloaded' });
    await remoteLaserForParticipant(pageB, pageAParticipantName).waitFor({ state: 'detached', timeout: 15_000 });
    await pageA.getByTestId('canvas-first-workspace').waitFor({ state: 'visible', timeout: 15_000 });
    await waitForFlowchart(pageA);
    await pageA.waitForTimeout(1_100);
    assert(await remoteLaserForParticipant(pageB, pageAParticipantName).count() === 0,
      'Laser reappeared after sender socket close/reconnect timeout.');

    const postReconnectBaseline = laserObserver.snapshot(main.id);
    const finalCanvas = pageA.getByTestId('diagram-canvas');
    const finalCanvasBox = await boxOf(finalCanvas, 'Final laser evidence canvas was missing.');
    await pageA.getByRole('button', { name: 'Laser pointer', exact: true }).click();
    await pageA.mouse.move(finalCanvasBox.x + 280, finalCanvasBox.y + 220);
    await pageA.mouse.down();
    await pageA.mouse.move(finalCanvasBox.x + 310, finalCanvasBox.y + 250, { steps: 3 });
    await remoteLaserForParticipant(pageB, pageAParticipantName).waitFor({ state: 'visible', timeout: 15_000 });
    await pageA.mouse.up();
    await remoteLaserForParticipant(pageB, pageAParticipantName).waitFor({ state: 'detached', timeout: 15_000 });
    await finalCanvas.focus();
    await pageA.keyboard.press('Escape');
    const finalLaserSnapshot = laserObserver.snapshot(main.id);
    assert(JSON.stringify(finalLaserSnapshot) === JSON.stringify(postReconnectBaseline),
      'Final laser gesture changed source/layout/activity after the reconnect baseline.');

    const presenterBaseline = laserObserver.snapshot(main.id);
    await pageA.getByRole('button', { name: 'Present', exact: true }).click();
    await pageA.getByRole('button', { name: 'Spotlight', exact: true }).click();
    const spotlight = pageB.getByRole('dialog', { name: 'Spotlight request' });
    await spotlight.waitFor({ state: 'visible', timeout: 15_000 });
    await spotlight.getByRole('button', { name: 'Ignore', exact: true }).click();
    await spotlight.waitFor({ state: 'detached', timeout: 15_000 });
    await pageA.getByRole('button', { name: 'Spotlight', exact: true }).click();
    await spotlight.waitFor({ state: 'visible', timeout: 15_000 });
    await spotlight.getByRole('button', { name: 'Accept', exact: true }).click();
    await pageB.locator('.presenter-desktop-controls').getByText(
      new RegExp(`^Following ${pageAParticipantName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`),
    ).waitFor({ state: 'visible', timeout: 15_000 });
    await pageB.emulateMedia({ reducedMotion: 'reduce' });
    await pageA.getByRole('button', { name: 'Zoom in', exact: true }).click();
    const presentedTransform = await transformedLayer(pageA).getAttribute('style');
    assert(presentedTransform, 'Presenter camera transform was missing.');
    await pageB.waitForFunction((expected) => {
      const sourceMatch = expected.match(/translate\(([-+\d.eE]+)px, ([-+\d.eE]+)px\) scale\(([-+\d.eE]+)\)/u);
      const receivedMatch = document.querySelector<HTMLElement>('.diagram-canvas-svg')?.parentElement?.getAttribute('style')
        ?.match(/translate\(([-+\d.eE]+)px, ([-+\d.eE]+)px\) scale\(([-+\d.eE]+)\)/u);
      const source = sourceMatch?.slice(1).map(Number);
      const received = receivedMatch?.slice(1).map(Number);
      return Boolean(source && received && source.every((value, index) => Math.abs(value - received[index]!) <= 0.51));
    }, presentedTransform, { timeout: 15_000 });
    assert(await transformedLayer(pageB).evaluate((element) => getComputedStyle(element).transitionDuration) === '0s',
      'Reduced-motion follower retained a camera transition.');
    await pageB.emulateMedia({ reducedMotion: 'no-preference' });

    await pageA.getByRole('button', { name: 'Laser pointer', exact: true }).click();
    const presenterCanvasBox = await boxOf(pageA.getByTestId('diagram-canvas'), 'Presenter laser canvas was missing.');
    await pageA.mouse.move(presenterCanvasBox.x + 260, presenterCanvasBox.y + 190);
    await pageA.mouse.down();
    await remoteLaserForParticipant(pageB, pageAParticipantName).waitFor({ state: 'visible', timeout: 15_000 });
    assert(await pageB.getByRole('button', { name: 'Leave', exact: true }).count() === 1,
      'Receiving a presenter laser unexpectedly ended follow mode.');
    await pageA.mouse.up();
    await pageA.keyboard.press('Escape');
    await remoteLaserForParticipant(pageB, pageAParticipantName).waitFor({ state: 'detached', timeout: 15_000 });

    await pageB.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await pageB.getByRole('button', { name: 'Leave', exact: true }).waitFor({ state: 'detached', timeout: 15_000 });

    const followPresenter = pageB.getByRole('button', { name: new RegExp(`^Follow ${pageAParticipantName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`) });
    await followPresenter.click();
    await nodeById(pageB, await nodeIdAt(pageB, 0)).click();
    await pageB.getByRole('button', { name: 'Leave', exact: true }).waitFor({ state: 'detached', timeout: 15_000 });
    await followPresenter.click();
    await pageB.getByRole('button', { name: 'Laser pointer', exact: true }).click();
    await pageB.getByRole('button', { name: 'Leave', exact: true }).waitFor({ state: 'detached', timeout: 15_000 });
    await pageB.getByRole('button', { name: 'Exit laser pointer', exact: true }).click();
    await followPresenter.click();
    const followerCanvasBox = await boxOf(pageB.getByTestId('diagram-canvas'), 'Follower pan canvas was missing.');
    await pageB.mouse.move(followerCanvasBox.x + 18, followerCanvasBox.y + 18);
    await pageB.mouse.down({ button: 'middle' });
    await pageB.mouse.move(followerCanvasBox.x + 70, followerCanvasBox.y + 62, { steps: 3 });
    await pageB.mouse.up({ button: 'middle' });
    await pageB.getByRole('button', { name: 'Leave', exact: true }).waitFor({ state: 'detached', timeout: 15_000 });

    await followPresenter.click();
    await selectTabByName(pageA, 'Local view');
    await pageB.getByRole('tab', { name: 'Local view', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    await pageB.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
      .some((tab) => tab.textContent?.trim() === 'Local view' && tab.getAttribute('aria-selected') === 'true'), undefined, { timeout: 15_000 });
    assert(await pageB.getByRole('tab', { name: 'Local view', exact: true }).getAttribute('aria-selected') === 'true',
      'Follower did not track the presenter active diagram.');
    await pageB.keyboard.press('Escape');
    await pageB.getByRole('button', { name: 'Leave', exact: true }).waitFor({ state: 'detached', timeout: 15_000 });
    await selectTabByName(pageA, 'Main');
    await selectTabByName(pageB, 'Main');

    await followPresenter.click();
    await pageB.getByRole('button', { name: 'Leave', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    await pageA.reload({ waitUntil: 'domcontentloaded' });
    await pageB.getByRole('button', { name: 'Leave', exact: true }).waitFor({ state: 'detached', timeout: 15_000 });

    await pageA.getByTestId('canvas-first-workspace').waitFor({ state: 'visible', timeout: 15_000 });
    await waitForFlowchart(pageA);
    await pageA.setViewportSize({ width: 390, height: 844 });
    const presenterMenu = pageA.locator('.presenter-mobile-menu').locator('summary');
    await presenterMenu.focus();
    await pageA.keyboard.press('Enter');
    const mobileStart = pageA.getByRole('button', { name: 'Start presenting', exact: true });
    const mobileStartBox = await boxOf(mobileStart, 'Mobile presenter control was missing.');
    assert(mobileStartBox.height >= 44, `Mobile presenter target was too short: ${mobileStartBox.height}px.`);
    await mobileStart.focus();
    await pageA.keyboard.press('Enter');
    await pageB.setViewportSize({ width: 390, height: 844 });
    const followerMenu = pageB.locator('.presenter-mobile-menu').locator('summary');
    await followerMenu.focus();
    await pageB.keyboard.press('Enter');
    const mobileFollow = pageB.locator('[data-testid^="mobile-follow-presenter-"]').first();
    await mobileFollow.waitFor({ state: 'visible', timeout: 15_000 });
    const mobileFollowBox = await boxOf(mobileFollow, 'Mobile follow control was missing.');
    assert(mobileFollowBox.height >= 44, `Mobile follow target was too short: ${mobileFollowBox.height}px.`);
    await mobileFollow.focus();
    await pageB.keyboard.press('Enter');
    await pageB.getByRole('button', { name: 'Stop following', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    await pageB.reload({ waitUntil: 'domcontentloaded' });
    await pageB.getByTestId('canvas-first-workspace').waitFor({ state: 'visible', timeout: 15_000 });
    await pageB.waitForTimeout(1_100);
    assert(await pageB.getByRole('button', { name: 'Leave', exact: true }).count() === 0,
      'Follower state replayed after reload.');
    const mobileStop = pageA.getByRole('button', { name: 'Stop presenting', exact: true });
    await mobileStop.focus();
    await pageA.keyboard.press('Enter');
    await Promise.all([
      pageA.setViewportSize({ width: 1440, height: 900 }),
      pageB.setViewportSize({ width: 1440, height: 900 }),
    ]);
    await pageA.locator('.presenter-mobile-menu').evaluate((element) => { (element as HTMLDetailsElement).open = false; });
    await Promise.all([
      pageA.reload({ waitUntil: 'domcontentloaded' }),
      pageB.reload({ waitUntil: 'domcontentloaded' }),
    ]);
    await Promise.all([waitForFlowchart(pageA), waitForFlowchart(pageB)]);
    await Promise.all([waitForMainTabActive(pageA), waitForMainTabActive(pageB)]);
    await pageA.waitForTimeout(1_100);
    const presenterAfter = laserObserver.snapshot(main.id);
    assert(getYjsSourceLayoutSignature(presenterAfter) === getYjsSourceLayoutSignature(presenterBaseline),
      'Presenter/follow/spotlight behavior changed durable source/layout.');
    const baselineActivityIds = new Set(presenterBaseline.activity.map((event) => event.id));
    assert(presenterAfter.activity.filter((event) => !baselineActivityIds.has(event.id))
      .every((event) => event.action === 'joined' || event.action === 'left'),
    'Presenter/follow/spotlight behavior wrote durable activity beyond ordinary reload lifecycle.');

    const durableAfterLaser = await mcp.readDiagram(sessionId, main.id);
    const sessionAfterLaser = await mcp.getSession(sessionId);
    const yjsAfterLaser = finalLaserSnapshot;
    const persistedLaserObserver = await openYjsSessionObserver(mcpUrl, sessionId, { cookie: roomAccess.cookie, origin: baseUrl });
    const persistedAfterLaser = persistedLaserObserver.snapshot(main.id);
    persistedLaserObserver.destroy();
    laserObserver.destroy();
    assert(durableAfterLaser.revision === durableBeforeLaser.revision
      && durableAfterLaser.mermaidText === durableBeforeLaser.mermaidText,
    'Laser use changed durable diagram source/revision.');
    assert(JSON.stringify(sessionAfterLaser.diagrams) === JSON.stringify(sessionBeforeLaser.diagrams),
      'Laser use changed the exported session diagram catalog/revisions.');
    assert(getYjsSourceLayoutSignature(yjsAfterLaser) === getYjsSourceLayoutSignature(yjsBeforeLaser),
      'Laser lifecycle testing changed durable source/layout.');
    assert(JSON.stringify(persistedAfterLaser) === JSON.stringify(presenterAfter),
      'Fresh persisted reload did not match the post-reconnect durable source/layout/activity baseline.');

    await nodeById(pageA, presenceNodeId).click();
    await pageA.getByRole('button', { name: 'Edit label', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    await pageA.getByRole('button', { name: 'Edit label', exact: true }).click();
    const nodeLabelInput = pageA.locator('input[placeholder="node label"]');
    await nodeLabelInput.waitFor({ state: 'visible', timeout: 15_000 });
    await pageB.getByTestId(`remote-node-editing-${presenceNodeId}`).waitFor({ state: 'visible', timeout: 15_000 });
    await pageARemoteCursor.locator('span').waitFor({ state: 'detached', timeout: 15_000 });
    await pageB.screenshot({ path: '/tmp/arielcharts-node-editing-awareness.png' });
    await nodeLabelInput.fill('Browser draft should not sync');
    await pageA.evaluate(() => { window.dispatchEvent(new Event('blur')); });
    await pageB.getByTestId(`remote-node-editing-${presenceNodeId}`).waitFor({ state: 'detached', timeout: 15_000 });
    assert(await nodeLabelInput.inputValue() === 'Browser draft should not sync', 'Inactive presence cleanup discarded the local node-label draft.');
    await pageA.waitForTimeout(NEGATIVE_OBSERVATION_WINDOW_MS);
    const draftRead = await mcp.readDiagram(sessionId, main.id);
    assert(draftRead.mermaidText === mergedSource, 'A node-label draft streamed through shared Mermaid source before commit.');
    console.log('E2E canvas-presence: before-focus');
    await pageA.evaluate(() => { window.dispatchEvent(new Event('focus')); });
    console.log('E2E canvas-presence: after-focus');
    await pageB.getByTestId(`remote-node-editing-${presenceNodeId}`).waitFor({ state: 'visible', timeout: 15_000 });
    const resumedCanvasBox = await boxOf(pageA.getByTestId('diagram-canvas'), 'Canvas was missing after focus.');
    console.log('E2E canvas-presence: before-fresh-cursor');
    await pageA.mouse.move(resumedCanvasBox.x + 48, resumedCanvasBox.y + resumedCanvasBox.height - 48);
    await pageARemoteCursor.waitFor({ state: 'visible', timeout: 15_000 });
    console.log('E2E canvas-presence: fresh-cursor-visible');
    await pageA.keyboard.press('Escape');
    await pageB.getByTestId(`remote-node-editing-${presenceNodeId}`).waitFor({ state: 'detached', timeout: 15_000 });
    await pageARemoteCursor.locator('span').waitFor({ state: 'visible', timeout: 15_000 });

    await presenceNode.click();
    await pageA.getByRole('button', { name: 'Edit label', exact: true }).click();
    await nodeLabelInput.fill('Browser edited');
    await pageA.keyboard.press('Enter');
    await pageB.getByTestId(`remote-node-editing-${presenceNodeId}`).waitFor({ state: 'detached', timeout: 15_000 });
    await pageB.getByRole('button', { name: 'square: Browser edited', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    const committedRead = await mcp.readDiagram(sessionId, main.id);
    assert(committedRead.mermaidText.includes('Browser edited'), 'Committed node-label edit did not converge through Mermaid source.');

    await pageA.getByTestId('activity-flyout-toggle').click();
    await pageA.getByTestId('activity-flyout').waitFor({ state: 'visible', timeout: 15_000 });
    await pageB.getByTestId(`remote-node-selection-${presenceNodeId}`).waitFor({ state: 'detached', timeout: 15_000 });

    const history = await mcp.listDiagramHistory(sessionId, main.id);
    const previewRevision = history.revisions.find((revision) => revision.resultRevision !== history.currentRevision) ?? history.revisions[0];
    assert(previewRevision, 'Collaboration presence fixture did not retain a history revision to preview.');
    const previewButton = pageA.getByTestId(`history-revision-${previewRevision.id}`).getByRole('button', { name: 'Preview', exact: true });
    await previewButton.waitFor({ state: 'visible', timeout: 15_000 });

    const refreshedPresenceNodeBox = await boxOf(presenceNode, 'Presence fixture node was obscured before detached preview.');
    await pageA.mouse.move(refreshedPresenceNodeBox.x + (refreshedPresenceNodeBox.width / 2), refreshedPresenceNodeBox.y + (refreshedPresenceNodeBox.height / 2));
    await presenceNode.click();
    await pageARemoteCursor.waitFor({ state: 'visible', timeout: 15_000 });
    await pageB.getByTestId(`remote-node-selection-${presenceNodeId}`).waitFor({ state: 'visible', timeout: 15_000 });

    await presenceNode.click();
    await pageA.getByRole('button', { name: 'Edit label', exact: true }).click();
    await pageB.getByTestId(`remote-node-editing-${presenceNodeId}`).waitFor({ state: 'visible', timeout: 15_000 });
    await previewButton.evaluate((button) => { (button as HTMLButtonElement).focus(); });
    await pageA.keyboard.press('Enter');
    await pageA.getByTestId('history-preview-notice').waitFor({ state: 'visible', timeout: 15_000 });
    await pageARemoteCursor.waitFor({ state: 'detached', timeout: 15_000 });
    await pageB.getByTestId(`remote-node-selection-${presenceNodeId}`).waitFor({ state: 'detached', timeout: 15_000 });
    await pageB.getByTestId(`remote-node-editing-${presenceNodeId}`).waitFor({ state: 'detached', timeout: 15_000 });

    const cancelPreview = pageA.getByRole('button', { name: 'Cancel preview', exact: true });
    await cancelPreview.evaluate((button) => { (button as HTMLButtonElement).focus(); });
    await pageA.keyboard.press('Enter');
    await pageA.getByTestId('history-preview-notice').waitFor({ state: 'detached', timeout: 15_000 });
    await pageARemoteCursor.waitFor({ state: 'visible', timeout: 15_000 });
    await pageB.getByTestId(`remote-node-selection-${presenceNodeId}`).waitFor({ state: 'visible', timeout: 15_000 });

    await presenceNode.click();
    await pageA.getByTestId('canvas-node-toolbar').waitFor({ state: 'visible', timeout: 15_000 });
    await pageA.getByRole('button', { name: 'Copy selected nodes', exact: true }).click();
    await pageB.getByTestId(`remote-node-selection-${presenceNodeId}`).waitFor({ state: 'visible', timeout: 15_000 });

    await previewButton.click();
    await pageA.getByTestId('history-preview-notice').waitFor({ state: 'visible', timeout: 15_000 });
    await pageARemoteCursor.waitFor({ state: 'detached', timeout: 15_000 });
    await pageB.getByTestId(`remote-node-selection-${presenceNodeId}`).waitFor({ state: 'detached', timeout: 15_000 });
    await pageA.getByRole('button', { name: 'Cancel preview', exact: true }).click();
    await pageA.getByTestId('history-preview-notice').waitFor({ state: 'detached', timeout: 15_000 });
    await pageA.waitForTimeout(200);
    assert(await pageARemoteCursor.count() === 0,
      'Pointer-entered history preview leaked a stale cursor timer after cancellation.');
    assert(await pageB.getByTestId(`remote-node-selection-${presenceNodeId}`).count() === 0,
      'Pointer-entered history preview republished a selection cleared by workspace click-away.');

    await pageA.getByRole('button', { name: 'Close activity and history', exact: true }).click();
    await pageB.getByTestId(`remote-node-selection-${presenceNodeId}`).waitFor({ state: 'detached', timeout: 15_000 });

    const dragNodeId = await nodeIdAt(pageA, 0);
    const remoteNodeId = await nodeIdAt(pageA, 1);
    assert(dragNodeId !== remoteNodeId, 'Collaboration drag fixture requires two distinct nodes.');
    const activeDragNode = nodeById(pageA, dragNodeId);
    const remoteNode = nodeById(pageB, remoteNodeId);
    await nudgeNode(pageA, activeDragNode, 110, 34, true);
    assertNoReactFlowError015(diagnosticsA.reactFlowError015, 'when browser A began its node drag');
    const heldBeforeRemote = await boxOf(activeDragNode, 'Active drag node disappeared before remote update.');
    await nudgeNode(pageB, remoteNode, -84, 46);
    assertNoReactFlowError015(diagnosticsB.reactFlowError015, 'when browser B completed its node drag');
    await pageA.waitForTimeout(500);
    const heldAfterRemote = await boxOf(activeDragNode, 'Active drag node disappeared during remote update.');
    const activeDragStable = positionsMatch(heldAfterRemote, heldBeforeRemote);
    assert(activeDragStable, `Remote layout update jittered active drag overlay: before=${JSON.stringify(heldBeforeRemote)} after=${JSON.stringify(heldAfterRemote)}`);
    await pageA.mouse.up();
    await pageA.waitForTimeout(700);
    assertNoReactFlowError015(diagnosticsA.reactFlowError015, 'when browser A completed its node drag');
    const finalA = await getReactFlowNodePosition(nodeById(pageA, dragNodeId), 'Dragged node disappeared after drag stop');
    const finalB = await getReactFlowNodePosition(nodeById(pageB, dragNodeId), 'Remote replica dragged node disappeared after drag stop');
    const replicasConverged = positionsMatch(finalA, finalB);
    assert(replicasConverged, `Drag replicas did not converge: A=${JSON.stringify(finalA)} B=${JSON.stringify(finalB)}`);

    const releasedPosition = finalB;
    await nudgeNode(pageB, nodeById(pageB, dragNodeId), -72, 52);
    assertNoReactFlowError015(diagnosticsB.reactFlowError015, 'when browser B dragged the released node');
    await waitForReactFlowNodePositionMovement(pageB, dragNodeId, releasedPosition);
    const winnerB = await getReactFlowNodePosition(nodeById(pageB, dragNodeId), 'Browser B winner node disappeared after post-release drag');
    const postReleaseWinnerMoved = Math.hypot(winnerB.x - releasedPosition.x, winnerB.y - releasedPosition.y) >= 8;
    assert(postReleaseWinnerMoved, `Post-release same-node drag did not establish a new winner: before=${JSON.stringify(releasedPosition)} after=${JSON.stringify(winnerB)}`);
    await waitForReactFlowNodePositionMatch(pageA, dragNodeId, winnerB);
    const winnerA = await getReactFlowNodePosition(nodeById(pageA, dragNodeId), 'Browser A replica lost the post-release winner node');
    const postReleaseReplicasConverged = positionsMatch(winnerA, winnerB);
    assert(postReleaseReplicasConverged, `Post-release same-node winner did not converge: A=${JSON.stringify(winnerA)} B=${JSON.stringify(winnerB)}`);

    const pendingPrune = await mcp.createDiagramWithLatestRevision(sessionId, 'Pending prune', PENDING_PRUNE_FLOWCHART);
    await Promise.all([
      pageA.getByRole('tab', { name: pendingPrune.name, exact: true }).waitFor({ state: 'visible', timeout: 15_000 }),
      pageB.getByRole('tab', { name: pendingPrune.name, exact: true }).waitFor({ state: 'visible', timeout: 15_000 }),
    ]);
    await Promise.all([
      selectTabByName(pageA, pendingPrune.name),
      selectTabByName(pageB, pendingPrune.name),
    ]);
    await Promise.all([ensureSourceFlyoutOpen(pageA), ensureSourceFlyoutOpen(pageB)]);
    await Promise.all([
      waitForSource(pageA, PENDING_PRUNE_FLOWCHART),
      waitForSource(pageB, PENDING_PRUNE_FLOWCHART),
      waitForFlowchart(pageA),
      waitForFlowchart(pageB),
    ]);

    let observer: YjsSessionObserver | null = null;
    let freshObserver: YjsSessionObserver | null = null;
    let clockPaused = false;
    let raceMouseHeld = false;
    let removalAdvanceMs = -1;
    let pendingPrunedBeforeStop = false;
    let pendingPrunedAfterStop = false;
    let freshObserverConfirmed = false;
    let reusedNodeMatchesInitial = false;
    let reusedNodeRejectedDraggedPosition = false;
    let restoredReplicasConverged = false;
    try {
      observer = await openYjsSessionObserver(mcpUrl, sessionId, { cookie: roomAccess.cookie, origin: baseUrl });
      await observer.waitFor(
        (current) => current.snapshot(pendingPrune.id).mermaidText === PENDING_PRUNE_FLOWCHART,
        'the pending-prune diagram source',
      );
      assert(observer.diagramExists(pendingPrune.id), 'Pending-prune fixture diagram is absent from the canonical Yjs map.');
      assert(!observer.hasNodePosition(pendingPrune.id, 'A'), 'Pending-prune fixture unexpectedly began with a persisted position for A.');

      const initialA = await getReactFlowNodePosition(nodeById(pageA, 'A'), 'Pending-prune node A was missing before the race');
      const pauseTime = await pageA.evaluate(() => Date.now() + 100);
      await pageA.clock.pauseAt(pauseTime);
      clockPaused = true;

      await nudgeNode(pageA, nodeById(pageA, 'A'), 132, 48, true);
      raceMouseHeld = true;
      const queuedA = await getReactFlowNodePosition(nodeById(pageA, 'A'), 'Pending-prune node A disappeared during its held drag');
      assert(Math.hypot(queuedA.x - initialA.x, queuedA.y - initialA.y) >= 8,
        `Held drag did not queue a meaningful position change: initial=${JSON.stringify(initialA)} queued=${JSON.stringify(queuedA)}`);

      await replaceSource(pageB, PENDING_PRUNE_REMOVED);
      await observer.waitFor(
        (current) => current.snapshot(pendingPrune.id).mermaidText === PENDING_PRUNE_REMOVED,
        'the source edit that removes node A',
      );
      await waitForSource(pageB, PENDING_PRUNE_REMOVED);
      assert(observer.diagramExists(pendingPrune.id), 'Pending-prune diagram disappeared before the removal race.');
      const removedNodeHistory = observer.trackNodePosition(pendingPrune.id, 'A');
      removalAdvanceMs = await advanceClockUntilNodePresence(pageA, 'A', 0, 120);
      assert(removalAdvanceMs < 120,
        `Node A was not reconciled away before the 120ms drag commit deadline: advanced=${removalAdvanceMs}ms.`);

      await pageA.clock.runFor(250);
      await removedNodeHistory.expectAbsentFor(NEGATIVE_OBSERVATION_WINDOW_MS, 'the post-timer observation window');
      pendingPrunedBeforeStop = observer.diagramExists(pendingPrune.id)
        && !removedNodeHistory.hasAppeared()
        && !observer.hasNodePosition(pendingPrune.id, 'A');
      assert(pendingPrunedBeforeStop, 'The expired drag timer resurrected removed node A in the canonical positions map.');
      assert(observer.snapshot(pendingPrune.id).mermaidText === PENDING_PRUNE_REMOVED,
        'The pending-prune source changed during the timer observation window.');

      await pageA.mouse.up();
      raceMouseHeld = false;
      await pageA.clock.runFor(250);
      await removedNodeHistory.expectAbsentFor(NEGATIVE_OBSERVATION_WINDOW_MS, 'the post-drag-stop observation window');
      pendingPrunedAfterStop = observer.diagramExists(pendingPrune.id)
        && !removedNodeHistory.hasAppeared()
        && !observer.hasNodePosition(pendingPrune.id, 'A');
      assert(pendingPrunedAfterStop, 'Drag stop resurrected removed node A in the canonical positions map.');
      assert(observer.snapshot(pendingPrune.id).mermaidText === PENDING_PRUNE_REMOVED,
        'The pending-prune source changed during the drag-stop observation window.');

      freshObserver = await openYjsSessionObserver(mcpUrl, sessionId, { cookie: roomAccess.cookie, origin: baseUrl });
      const freshRemovedSnapshot = freshObserver.snapshot(pendingPrune.id);
      freshObserverConfirmed = freshRemovedSnapshot.exists
        && freshRemovedSnapshot.mermaidText === PENDING_PRUNE_REMOVED
        && !freshObserver.hasNodePosition(pendingPrune.id, 'A');
      assert(freshObserverConfirmed,
        `A fresh Yjs observer did not confirm canonical removal: ${JSON.stringify(freshRemovedSnapshot)}`);

      await replaceSource(pageB, PENDING_PRUNE_FLOWCHART);
      await Promise.all([
        observer.waitFor(
          (current) => current.snapshot(pendingPrune.id).mermaidText === PENDING_PRUNE_FLOWCHART,
          'restored source in the original observer',
        ),
        freshObserver.waitFor(
          (current) => current.snapshot(pendingPrune.id).mermaidText === PENDING_PRUNE_FLOWCHART,
          'restored source in the fresh observer',
        ),
      ]);
      await advanceClockUntilNodePresence(pageA, 'A', 1, 500);
      await pageA.clock.resume();
      clockPaused = false;

      await Promise.all([
        waitForSource(pageA, PENDING_PRUNE_FLOWCHART),
        waitForSource(pageB, PENDING_PRUNE_FLOWCHART),
        waitForFlowchart(pageA),
        waitForFlowchart(pageB),
      ]);
      await Promise.all([closeSourceFlyout(pageA), closeSourceFlyout(pageB)]);
      const reusedA = await getReactFlowNodePosition(nodeById(pageA, 'A'), 'Reused node A was missing after source restoration');
      reusedNodeMatchesInitial = positionsMatch(reusedA, initialA);
      reusedNodeRejectedDraggedPosition = Math.hypot(reusedA.x - queuedA.x, reusedA.y - queuedA.y) >= 8;
      assert(reusedNodeMatchesInitial,
        `Reused node A did not return to its clean layout position: initial=${JSON.stringify(initialA)} reused=${JSON.stringify(reusedA)}`);
      assert(reusedNodeRejectedDraggedPosition,
        `Reused node A inherited its removed drag position: queued=${JSON.stringify(queuedA)} reused=${JSON.stringify(reusedA)}`);
      assert(!removedNodeHistory.hasAppeared()
        && observer.diagramExists(pendingPrune.id)
        && freshObserver.diagramExists(pendingPrune.id)
        && !observer.hasNodePosition(pendingPrune.id, 'A')
        && !freshObserver.hasNodePosition(pendingPrune.id, 'A'),
        'Reusing node ID A repopulated the canonical positions map with a stale coordinate.');

      const validB = await getReactFlowNodePosition(nodeById(pageA, 'B'), 'Valid node B was missing after the pending-prune race');
      await Promise.all([
        waitForReactFlowNodePositionMatch(pageB, 'A', reusedA),
        waitForReactFlowNodePositionMatch(pageB, 'B', validB),
      ]);
      const replicaA = await getReactFlowNodePosition(nodeById(pageB, 'A'), 'Browser B lost reused node A after source restoration');
      const replicaB = await getReactFlowNodePosition(nodeById(pageB, 'B'), 'Browser B lost valid node B after source restoration');
      restoredReplicasConverged = positionsMatch(replicaA, reusedA) && positionsMatch(replicaB, validB);
      assert(restoredReplicasConverged, 'Valid and reused nodes did not converge after the pending-prune race.');
    } finally {
      if (raceMouseHeld) await pageA.mouse.up().catch(() => undefined);
      if (clockPaused) await pageA.clock.resume().catch(() => undefined);
      freshObserver?.destroy();
      observer?.destroy();
    }

    assertNoPageErrors(diagnosticsA.pageErrors, 'in collaboration browser A');
    assertNoPageErrors(diagnosticsB.pageErrors, 'in collaboration browser B');
    assertNoReactFlowError015(diagnosticsA.reactFlowError015, 'during the collaboration gate');
    assertNoReactFlowError015(diagnosticsB.reactFlowError015, 'during the collaboration gate');
    await pageA.screenshot({ path: '/tmp/arielcharts-collaboration.png' });

    console.log(`modern MCP stale write rejected=${staleRejected}`);
    console.log(`browser/MCP merged source converged=${merged.mermaidText.includes(HUMAN_EDGE.trim()) && merged.mermaidText.includes(AGENT_EDGE.trim())}`);
    console.log(`remote local-state isolation tab=${activeTabPreserved} flyouts=${sourceFlyoutsPreserved} selection=${localSelectionPreserved} mode=${localConnectModePreserved} camera=${localCameraPreserved}`);
    console.log('remote node editing awareness open/draft/inactive-resume/Escape/commit/history cleanup passed=true');
    console.log('awareness laser world reprojection, mouse/stylus/touch/Escape, a11y media, fade/switch/socket/reconnect cleanup, camera and durable isolation passed=true');
    console.log('awareness presenter voluntary spotlight, camera/tab follow, local escape, disconnect/reload cleanup, and durable isolation passed=true');
    console.log(`concurrent drag active overlay stable=${activeDragStable} replicas converged=${replicasConverged}`);
    console.log(`post-release same-node winner moved=${postReleaseWinnerMoved} replicas converged=${postReleaseReplicasConverged}`);
    console.log(`pending removal reconciled before commit=${removalAdvanceMs}ms timer pruned=${pendingPrunedBeforeStop} stop pruned=${pendingPrunedAfterStop}`);
    console.log(`fresh canonical observer confirmed=${freshObserverConfirmed} reused initial=${reusedNodeMatchesInitial} rejected dragged=${reusedNodeRejectedDraggedPosition} replicas converged=${restoredReplicasConverged}`);
    console.log('protected room access, cross-room isolation, fragment exchange, and rotation revocation passed=true');
    console.log('COLLABORATION E2E PASSED');
  } finally {
    await browser.close();
  }
}

withOwnedServices(validateCollaboration).catch((error) => {
  console.error(error);
  process.exit(1);
});
