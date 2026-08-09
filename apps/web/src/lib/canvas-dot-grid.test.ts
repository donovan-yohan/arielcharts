import { describe, expect, it } from 'vitest';
import { getCanvasDotGridGeometry } from './canvas-dot-grid';

describe('getCanvasDotGridGeometry', () => {
  it('maps the camera origin and canvas-unit spacing into screen-space grid styles', () => {
    expect(getCanvasDotGridGeometry({ panX: 24, panY: -8, zoom: 1 })).toEqual({
      backgroundPosition: '14px -18px',
      backgroundSize: '20px 20px',
      dotRadius: '1px',
    });
  });

  it('scales spacing and dot radius with zoom while retaining the shared camera origin', () => {
    expect(getCanvasDotGridGeometry({ panX: 24, panY: -8, zoom: 1.5 })).toEqual({
      backgroundPosition: '9px -23px',
      backgroundSize: '30px 30px',
      dotRadius: '1.5px',
    });
  });
});
