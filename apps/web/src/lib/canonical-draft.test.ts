import { describe, expect, it } from 'vitest';
import { getDirtyDraftFields, reconcileCanonicalDraft, sameCanonicalDraft } from './canonical-draft';

describe('canonical form drafts', () => {
  it('keeps dirty fields while adopting untouched fields from a remote source update', () => {
    const canonical = { id: 'api', label: 'API', title: 'Public' };
    const draft = { ...canonical, label: 'Gateway' };
    const remote = { id: 'api', label: 'API v2', title: 'Public API' };
    const dirty = getDirtyDraftFields(draft, canonical);
    expect(reconcileCanonicalDraft(remote, draft, dirty)).toEqual({ id: 'api', label: 'Gateway', title: 'Public API' });
  });

  it('returns to the canonical baseline after a successful save', () => {
    const canonical = { id: 'api', label: 'Gateway', title: 'Public API' };
    const draft = { ...canonical, title: 'External API' };
    expect(getDirtyDraftFields(canonical, canonical)).toEqual(new Set());
    expect(reconcileCanonicalDraft(canonical, draft, new Set())).toEqual(canonical);
    expect(sameCanonicalDraft(reconcileCanonicalDraft(canonical, draft, new Set()), canonical)).toBe(true);
  });
});
