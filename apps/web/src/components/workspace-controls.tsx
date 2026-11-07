'use client';

import React, { createContext, useContext, useEffect, useId, useRef, type ComponentProps, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FOCUSABLE_SELECTOR } from '../lib/focusable';

type ButtonProps = ComponentProps<'button'>;
type RecordProps = ComponentProps<'form'> & { error?: string | null };
type RecordFeedback = { error: string | null; errorId: string };
const RecordFeedbackContext = createContext<RecordFeedback | null>(null);
type InputProps = ComponentProps<'input'> & { label?: ReactNode };
type SelectProps = ComponentProps<'select'> & { label?: ReactNode };
type TextareaProps = ComponentProps<'textarea'> & { label?: ReactNode };
export interface WorkspaceConfirmationProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function WorkspaceRecord({ error = null, children, ...props }: RecordProps) {
  const errorId = useId();
  return <RecordFeedbackContext value={{ error, errorId }}><form {...props} data-workspace-record="true">
    {props['aria-label'] ? <strong className="workspace-record-heading">{props['aria-label']}</strong> : null}{children}
  </form></RecordFeedbackContext>;
}
export function WorkspaceRecordError({ error }: { error: string | null }) {
  const record = useContext(RecordFeedbackContext);
  return error ? <small className="semantic-editor-error" id={record?.errorId} role="alert">{error}</small> : null;
}
export function WorkspaceButton({ className = '', type = 'button', ...props }: ButtonProps) {
  const danger = props['aria-label']?.startsWith('Delete');
  return <button data-danger={danger || undefined} {...props} type={type} className={`workspace-control-button ${className}`} />;
}
export function WorkspaceInput({ label, className = '', ...props }: InputProps) {
  const record = useContext(RecordFeedbackContext);
  const generatedId = useId(); const id = props.id ?? generatedId;
  const control = <input aria-invalid={record?.error ? true : undefined} aria-describedby={record?.error ? record.errorId : undefined} {...props} onKeyDown={(event) => { if (event.nativeEvent.isComposing || event.key === 'Process') return; props.onKeyDown?.(event); }} id={id} className={`workspace-control-input ${className}`} />;
  if (props.type === 'checkbox' || props.type === 'radio' || props.type === 'hidden' || props.type === 'file') return control;
  return <span className="workspace-control-field" data-canvas-pan-exclusion="true"><label htmlFor={id}>{label ?? props['aria-label'] ?? props.placeholder}</label>{control}</span>;
}
export function WorkspaceSelect({ label, className = '', ...props }: SelectProps) {
  const record = useContext(RecordFeedbackContext);
  const generatedId = useId(); const id = props.id ?? generatedId;
  return <span className="workspace-control-field" data-canvas-pan-exclusion="true"><label htmlFor={id}>{label ?? props['aria-label']}</label><select aria-invalid={record?.error ? true : undefined} aria-describedby={record?.error ? record.errorId : undefined} {...props} id={id} className={`workspace-control-input ${className}`} /></span>;
}
export function WorkspaceTextarea({ label, className = '', ...props }: TextareaProps) {
  const record = useContext(RecordFeedbackContext);
  const generatedId = useId(); const id = props.id ?? generatedId;
  return <span className="workspace-control-field" data-canvas-pan-exclusion="true"><label htmlFor={id}>{label ?? props['aria-label'] ?? props.placeholder}</label><textarea aria-invalid={record?.error ? true : undefined} aria-describedby={record?.error ? record.errorId : undefined} {...props} id={id} className={`workspace-control-input ${className}`} /></span>;
}

export function WorkspaceConfirmation({ title, children, confirmLabel, pending = false, onCancel, onConfirm }: WorkspaceConfirmationProps) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = Array.from(document.body.children).filter((element): element is HTMLElement => element instanceof HTMLElement && !element.contains(ref.current));
    const previous = background.map((element) => element.inert);
    background.forEach((element) => { element.inert = true; });
    cancelRef.current?.focus();
    return () => {
      background.forEach((element, index) => { element.inert = previous[index]!; });
      if (origin?.isConnected) origin.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (pending) ref.current?.focus({ preventScroll: true });
    else if (document.activeElement === ref.current) cancelRef.current?.focus({ preventScroll: true });
  }, [pending]);
  return createPortal(<div className="modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !pending) onCancel(); }}>
    <div aria-labelledby={titleId} aria-modal="true" aria-busy={pending || undefined} tabIndex={-1} className="modal-dialog workspace-confirmation" ref={ref} role="dialog" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!pending) onCancel(); }
      if (event.key === 'Tab') {
        const stops = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []).filter((element) => !element.hasAttribute('disabled'));
        const next = event.shiftKey ? stops.at(-1) : stops[0];
        if (stops.length === 0 || !stops.includes(document.activeElement as HTMLElement) || document.activeElement === (event.shiftKey ? stops[0] : stops.at(-1))) {
          event.preventDefault(); (next ?? ref.current)?.focus({ preventScroll: true });
        }
      }
    }}>
      <h2 id={titleId}>{title}</h2><div className="workspace-confirmation-body">{children}</div>
      <div className="workspace-record-actions"><WorkspaceButton disabled={pending} onClick={onCancel} ref={cancelRef}>Cancel</WorkspaceButton><WorkspaceButton disabled={pending} onClick={onConfirm} data-danger="true">{pending ? 'Please wait…' : confirmLabel}</WorkspaceButton></div>
    </div>
  </div>, document.body);
}
