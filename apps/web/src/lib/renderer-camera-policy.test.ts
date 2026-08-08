import { describe, expect, it } from 'vitest';
import {
  getNextPreviewCameraLock,
  shouldFitInitialCamera,
} from './renderer-camera-policy';

describe('renderer camera policy', () => {
  it('holds camera ownership through preview exit and transient zero-node reconciliation', () => {
    const entered = getNextPreviewCameraLock(false, 'preview-entered');
    const exiting = getNextPreviewCameraLock(entered, 'preview-exited');

    expect(entered).toBe(true);
    expect(exiting).toBe(true);
    expect(shouldFitInitialCamera(exiting, false, true)).toBe(false);

    const liveSettled = getNextPreviewCameraLock(exiting, 'live-render-accepted');
    expect(liveSettled).toBe(false);
    expect(shouldFitInitialCamera(liveSettled, false, false)).toBe(false);
  });

  it('fits an initial render once without re-arming after the canvas becomes empty', () => {
    expect(shouldFitInitialCamera(false, false, false)).toBe(false);
    expect(shouldFitInitialCamera(false, false, true)).toBe(true);
    expect(shouldFitInitialCamera(false, true, true)).toBe(false);
  });
});
