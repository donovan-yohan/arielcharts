import type { CynefinItem, CynefinTransition } from './cynefin-mutations';
import { reconcileSemanticRenderIdentities, type SemanticRenderEntry, type SemanticRenderIdentityState } from './semantic-render-identities';

export type CynefinRenderEntry<T> = SemanticRenderEntry<T>;
export type CynefinRenderIdentityState<T> = SemanticRenderIdentityState<T>;

const itemOptions: { fingerprint: (item: CynefinItem) => string; prefix: string } = {
  fingerprint: (item) => JSON.stringify([item.domain, item.label]),
  prefix: 'cynefin-item-render',
};

const transitionOptions: { fingerprint: (transition: CynefinTransition) => string; prefix: string } = {
  fingerprint: (transition) => JSON.stringify([transition.from, transition.to, transition.label ?? null]),
  prefix: 'cynefin-transition-render',
};

export function reconcileCynefinItemRenderIdentities(
  previous: CynefinRenderIdentityState<CynefinItem> | null,
  items: readonly CynefinItem[],
): CynefinRenderIdentityState<CynefinItem> {
  return reconcileSemanticRenderIdentities(previous, items, itemOptions);
}

export function reconcileCynefinTransitionRenderIdentities(
  previous: CynefinRenderIdentityState<CynefinTransition> | null,
  transitions: readonly CynefinTransition[],
): CynefinRenderIdentityState<CynefinTransition> {
  return reconcileSemanticRenderIdentities(previous, transitions, transitionOptions);
}
