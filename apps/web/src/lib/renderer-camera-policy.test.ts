import { describe, expect, it } from 'vitest';
import {
  getNextPreviewCameraLock,
  getRendererKind,
  shouldFitRendererKindTransition,
  shouldResetInitialCameraFit,
} from './renderer-camera-policy';

describe('renderer camera policy', () => {
  it('fits only when the renderer changes between editable and static', () => {
    expect(shouldFitRendererKindTransition(null, 'editable')).toBe(false);
    expect(shouldFitRendererKindTransition('editable', 'editable')).toBe(false);
    expect(shouldFitRendererKindTransition('editable', 'static')).toBe(true);
    expect(shouldFitRendererKindTransition('static', 'editable')).toBe(true);
  });

  it('derives renderer kind from the capability boundary', () => {
    expect(getRendererKind(true)).toBe('editable');
    expect(getRendererKind(false)).toBe('static');
  });

  it('holds camera ownership through preview exit and transient zero-node reconciliation', () => {
    const entered = getNextPreviewCameraLock(false, 'preview-entered');
    const exiting = getNextPreviewCameraLock(entered, 'preview-exited');

    expect(entered).toBe(true);
    expect(exiting).toBe(true);
    expect(shouldResetInitialCameraFit(exiting, 0, true)).toBe(false);

    const liveSettled = getNextPreviewCameraLock(exiting, 'live-render-accepted');
    expect(liveSettled).toBe(false);
    expect(shouldResetInitialCameraFit(liveSettled, 2, true)).toBe(false);
  });
});
