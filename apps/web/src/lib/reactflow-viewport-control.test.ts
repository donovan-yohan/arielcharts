import { describe, expect, it } from 'vitest';
import { reconcileReactFlowViewport } from './reactflow-viewport-control';

describe('controlled React Flow viewport', () => {
  it('does not rerender when React Flow acknowledges the app-owned camera', () => {
    const current = { panX: 42, panY: -18, zoom: 1.5 };

    expect(reconcileReactFlowViewport(current, { x: 42, y: -18, zoom: 1.5 })).toBe(current);
  });

  it('adopts a new viewport once and then preserves that converged identity', () => {
    const initial = { panX: 42, panY: -18, zoom: 1.5 };
    const reported = { x: 16, y: 32, zoom: 1.25 };

    const adopted = reconcileReactFlowViewport(initial, reported);

    expect(adopted).toEqual({ panX: 16, panY: 32, zoom: 1.25 });
    expect(reconcileReactFlowViewport(adopted, reported)).toBe(adopted);
  });
});
