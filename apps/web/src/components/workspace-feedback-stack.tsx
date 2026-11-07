'use client';
import React, { Children, isValidElement, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
interface WorkspaceFeedbackStackProps { children: ReactNode; mutationError: string | null }

/** The stack is the single measured banner surface. Record diagnostics stay local. */
export function WorkspaceFeedbackStack({ children, mutationError }: WorkspaceFeedbackStackProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [duplicate, setDuplicate] = useState(false);
  useLayoutEffect(() => {
    const pane = ref.current?.closest('.workspace-diagram-pane');
    if (!pane) return;
    const update = () => setDuplicate(Boolean(mutationError && Array.from(pane.querySelectorAll('.semantic-editor-error')).some((element) => element.textContent === mutationError)));
    const observer = new MutationObserver(update); observer.observe(pane, { childList: true, characterData: true, subtree: true }); update();
    return () => observer.disconnect();
  }, [mutationError]);
  return <div className="workspace-feedback-stack" data-testid="workspace-feedback-stack" ref={ref}>{Children.map(children, (child) => duplicate && isValidElement<{ 'data-testid'?: string }>(child) && child.props['data-testid'] === 'mutation-error-banner' ? null : child)}</div>;
}
