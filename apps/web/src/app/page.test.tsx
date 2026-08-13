import { describe, expect, it } from 'vitest';

import Home from './page';
import { LocalWorkspaceGate } from '../components/local-workspace-gate';

describe('default route', () => {
  it('starts at the local handoff boundary without creating a room', () => {
    const page = Home();
    expect(page.type).toBe(LocalWorkspaceGate);
  });
});
