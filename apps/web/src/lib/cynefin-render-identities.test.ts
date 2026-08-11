import { describe, expect, it } from 'vitest';
import { getDirtyDraftFields, reconcileCanonicalDraft } from './canonical-draft';
import type { CynefinItem, CynefinTransition } from './cynefin-mutations';
import { reconcileCynefinItemRenderIdentities, reconcileCynefinTransitionRenderIdentities } from './cynefin-render-identities';

describe('Cynefin persistent render identities', () => {
  it('keeps an item form mounted through a remote rename and domain update', () => {
    const canonical: CynefinItem = { domain: 'complicated', label: 'Probe' };
    const preceding: CynefinItem = { domain: 'complex', label: 'Emergent' };
    const following: CynefinItem = { domain: 'complicated', label: 'Analyze' };
    const previous = reconcileCynefinItemRenderIdentities(null, [canonical, preceding, following]);
    const remote: CynefinItem = { domain: 'clear', label: 'Discovery' };
    const next = reconcileCynefinItemRenderIdentities(previous, [preceding, following, remote]);

    expect(next.entries[2]?.renderKey).toBe(previous.entries[0]?.renderKey);
    const dirty: CynefinItem = { ...canonical, label: 'Dirty probe' };
    expect(reconcileCanonicalDraft(remote, dirty, getDirtyDraftFields(dirty, canonical))).toEqual({
      domain: 'clear',
      label: 'Dirty probe',
    });
  });

  it('keeps a transition form mounted through a remote label rename and target update', () => {
    const canonical: CynefinTransition = { from: 'complex', label: 'Investigate', to: 'complicated' };
    const anchor: CynefinTransition = { from: 'chaotic', label: null, to: 'clear' };
    const previous = reconcileCynefinTransitionRenderIdentities(null, [canonical, anchor]);
    const remote: CynefinTransition = { from: 'complex', label: 'Explore', to: 'clear' };
    const next = reconcileCynefinTransitionRenderIdentities(previous, [remote, anchor]);

    expect(next.entries[0]?.renderKey).toBe(previous.entries[0]?.renderKey);
    const dirty: CynefinTransition = { ...canonical, from: 'confusion' };
    expect(reconcileCanonicalDraft(remote, dirty, getDirtyDraftFields(dirty, canonical))).toEqual({
      from: 'confusion',
      label: 'Explore',
      to: 'clear',
    });
  });

  it('does not remount exact records when same-label records are prepended elsewhere', () => {
    const item: CynefinItem = { domain: 'complicated', label: 'Probe' };
    const itemAnchor: CynefinItem = { domain: 'confusion', label: 'Observe' };
    const previousItems = reconcileCynefinItemRenderIdentities(null, [item, itemAnchor]);
    const nextItems = reconcileCynefinItemRenderIdentities(previousItems, [
      { domain: 'complex', label: 'Probe' },
      item,
      itemAnchor,
    ]);
    expect(nextItems.entries[1]?.renderKey).toBe(previousItems.entries[0]?.renderKey);

    const transition: CynefinTransition = { from: 'complex', label: 'Investigate', to: 'complicated' };
    const transitionAnchor: CynefinTransition = { from: 'chaotic', label: null, to: 'clear' };
    const previousTransitions = reconcileCynefinTransitionRenderIdentities(null, [transition, transitionAnchor]);
    const nextTransitions = reconcileCynefinTransitionRenderIdentities(previousTransitions, [
      { from: 'clear', label: 'Investigate', to: 'complicated' },
      transition,
      transitionAnchor,
    ]);
    expect(nextTransitions.entries[1]?.renderKey).toBe(previousTransitions.entries[0]?.renderKey);
  });

  it('never transfers render identities across identical ambiguous records', () => {
    const duplicate: CynefinItem = { domain: 'complex', label: 'Same' };
    const previous = reconcileCynefinItemRenderIdentities(null, [duplicate, duplicate]);
    const next = reconcileCynefinItemRenderIdentities(previous, [duplicate, duplicate]);
    const previousKeys = new Set(previous.entries.map((entry) => entry.renderKey));

    expect(next.entries.every((entry) => !previousKeys.has(entry.renderKey))).toBe(true);
  });
});
