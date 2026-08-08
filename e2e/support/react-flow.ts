import type { Locator, Page } from '@playwright/test';

export type ReactFlowError015Diagnostic = {
  channel: string;
  text: string;
};

export type ReactFlowDiagnostics = {
  pageErrors: string[];
  reactFlowError015: ReactFlowError015Diagnostic[];
};

export type ReactFlowPosition = {
  transform: string;
  x: number;
  y: number;
};

const REACT_FLOW_ERROR_015 = /(?:\bReact Flow\b[\s\S]*?(?:error#015|(?:error(?: code)?\s*)?#?015\b)|trying to drag a node that is not initialized)/iu;

/** Registers one pageerror listener for both general and React Flow-specific diagnostics. */
export function collectReactFlowDiagnostics(page: Page): ReactFlowDiagnostics {
  const pageErrors: string[] = [];
  const reactFlowError015: ReactFlowError015Diagnostic[] = [];
  const collectReactFlowError = (channel: string, text: string) => {
    if (REACT_FLOW_ERROR_015.test(text)) {
      reactFlowError015.push({ channel, text });
    }
  };

  page.on('console', (message) => collectReactFlowError(`console.${message.type()}`, message.text()));
  page.on('pageerror', (error) => {
    const text = error.stack ?? error.message;
    pageErrors.push(text);
    collectReactFlowError('pageerror', text);
  });

  return { pageErrors, reactFlowError015 };
}

export function assertNoReactFlowError015(diagnostics: ReactFlowError015Diagnostic[], context: string): void {
  if (diagnostics.length === 0) return;
  const detail = diagnostics.map(({ channel, text }) => `${channel}: ${text}`).join('\n');
  throw new Error(`React Flow #015 was emitted ${context}:\n${detail}`);
}

export function assertNoPageErrors(errors: string[], context: string): void {
  if (errors.length > 0) {
    throw new Error(`Browser page errors were emitted ${context}:\n${errors.join('\n')}`);
  }
}

export async function getReactFlowNodePosition(locator: Locator, message: string): Promise<ReactFlowPosition> {
  const position = await locator.evaluate((element) => {
    const transform = element.getAttribute('style')?.match(/transform:\s*([^;]+)/u)?.[1]
      ?? getComputedStyle(element).transform;
    const translate = transform.match(/translate(?:3d)?\(\s*(-?[\d.]+)px(?:,\s*|\s+)(-?[\d.]+)px/u);
    const matrix = transform.match(/^matrix\([^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*(-?[\d.]+),\s*(-?[\d.]+)\)$/u);
    if (translate) return { transform, x: Number(translate[1]), y: Number(translate[2]) };
    if (matrix) return { transform, x: Number(matrix[1]), y: Number(matrix[2]) };
    return null;
  });
  if (!position) {
    throw new Error(`${message}: could not parse local node transform.`);
  }
  return position;
}

export async function waitForReactFlowNodePositionMovement(
  page: Page,
  nodeId: string,
  from: { x: number; y: number },
  minimumDistance = 8,
): Promise<void> {
  await page.waitForFunction(({ id, initial, minimum }) => {
    const node = [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
      .find((element) => element.dataset.id === id);
    const transform = node?.getAttribute('style')?.match(/transform:\s*([^;]+)/u)?.[1]
      ?? (node ? getComputedStyle(node).transform : '');
    const translate = transform.match(/translate(?:3d)?\(\s*(-?[\d.]+)px(?:,\s*|\s+)(-?[\d.]+)px/u);
    const matrix = transform.match(/^matrix\([^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*(-?[\d.]+),\s*(-?[\d.]+)\)$/u);
    const position = translate
      ? { x: Number(translate[1]), y: Number(translate[2]) }
      : matrix
        ? { x: Number(matrix[1]), y: Number(matrix[2]) }
        : null;
    return position !== null && Math.hypot(position.x - initial.x, position.y - initial.y) >= minimum;
  }, { id: nodeId, initial: from, minimum: minimumDistance }, { timeout: 5_000 });
}

export async function waitForReactFlowNodePositionMatch(
  page: Page,
  nodeId: string,
  target: { x: number; y: number },
): Promise<void> {
  await waitForReactFlowNodePositions(page, { [nodeId]: target });
}

export async function waitForReactFlowNodePositions(
  page: Page,
  expected: Record<string, { x: number; y: number }>,
): Promise<void> {
  await page.waitForFunction((positions) => {
    for (const [nodeId, target] of Object.entries(positions)) {
      const node = [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
        .find((element) => element.dataset.id === nodeId);
      if (!node) return false;
      const transform = node.getAttribute('style')?.match(/transform:\s*([^;]+)/u)?.[1]
        ?? getComputedStyle(node).transform;
      const translate = transform.match(/translate(?:3d)?\(\s*(-?[\d.]+)px(?:,\s*|\s+)(-?[\d.]+)px/u);
      const matrix = transform.match(/^matrix\([^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*(-?[\d.]+),\s*(-?[\d.]+)\)$/u);
      const actual = translate
        ? { x: Number(translate[1]), y: Number(translate[2]) }
        : matrix
          ? { x: Number(matrix[1]), y: Number(matrix[2]) }
          : null;
      if (actual === null || Math.abs(actual.x - target.x) > 2 || Math.abs(actual.y - target.y) > 2) {
        return false;
      }
    }
    return true;
  }, expected, { timeout: 15_000 });
}
