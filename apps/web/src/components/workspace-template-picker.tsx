import type { StarterTemplate, StarterTemplateId } from '@arielcharts/shared';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Plus } from 'lucide-react';

const INTERACTIVE_OUTSIDE_TARGET = 'a[href], button, input, select, textarea, [contenteditable="true"], [role="button"], [role="link"], [role="menuitem"], [role="tab"], [tabindex]:not([tabindex="-1"])';

export function getTemplateMenuOrder(templates: readonly StarterTemplate[]): readonly StarterTemplate[] {
  const blank = templates.find((template) => template.id === 'blank');
  return blank ? [blank, ...templates.filter((template) => template.id !== 'blank')] : [...templates];
}

export function getTemplateMenuFocusIndex(key: string, currentIndex: number, itemCount: number): number | null {
  if (itemCount === 0) return null;
  if (key === 'ArrowDown') return (currentIndex + 1) % itemCount;
  if (key === 'ArrowUp') return (currentIndex - 1 + itemCount) % itemCount;
  if (key === 'Home') return 0;
  if (key === 'End') return itemCount - 1;
  return null;
}

export type TemplateMenuKeyboardAction =
  | { type: 'move'; index: number }
  | { type: 'select' }
  | { type: 'close'; returnFocus: boolean }
  | null;

export function getTemplateMenuKeyboardAction(
  key: string,
  currentIndex: number,
  itemCount: number,
): TemplateMenuKeyboardAction {
  if (key === 'Escape') return { type: 'close', returnFocus: true };
  if (key === 'Tab') return { type: 'close', returnFocus: false };
  if (key === 'Enter' || key === ' ') return { type: 'select' };
  const nextIndex = getTemplateMenuFocusIndex(key, currentIndex, itemCount);
  return nextIndex === null ? null : { type: 'move', index: nextIndex };
}

interface WorkspaceTemplatePickerProps {
  onCreateDiagram: (templateId: StarterTemplateId) => void;
  templates: readonly StarterTemplate[];
}

export function WorkspaceTemplatePicker({ onCreateDiagram, templates }: WorkspaceTemplatePickerProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const orderedTemplates = getTemplateMenuOrder(templates);

  const closeMenu = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) {
      window.requestAnimationFrame(() => { triggerRef.current?.focus(); });
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    window.requestAnimationFrame(() => { itemRefs.current[0]?.focus(); });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        const interactiveTarget = target instanceof Element && target.closest(INTERACTIVE_OUTSIDE_TARGET);
        closeMenu(!interactiveTarget);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); };
  }, [closeMenu, open]);

  const onItemKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number, templateId: StarterTemplateId) => {
    const action = getTemplateMenuKeyboardAction(event.key, index, orderedTemplates.length);
    if (!action) return;
    if (action.type === 'close') {
      if (action.returnFocus) {
        event.preventDefault();
        closeMenu(true);
      } else {
        window.requestAnimationFrame(() => { setOpen(false); });
      }
    } else if (action.type === 'select') {
      event.preventDefault();
      setOpen(false);
      onCreateDiagram(templateId);
    } else {
      event.preventDefault();
      setActiveIndex(action.index);
      itemRefs.current[action.index]?.focus();
    }
  };

  return (
    <div className="workspace-template-picker">
      <button
        aria-controls="starter-template-menu"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Create diagram from template"
        className="workspace-diagram-tab-add workspace-touch-label"
        data-touch-label="New diagram"
        data-testid="create-diagram-tab"
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            setActiveIndex(0);
            setOpen(true);
          }
        }}
        ref={triggerRef}
        title="Create diagram from template"
        type="button"
      ><Plus aria-hidden="true" size={18} /></button>
      {open ? (
        <div aria-label="Starter templates" className="workspace-template-menu" id="starter-template-menu" ref={menuRef} role="menu">
          {orderedTemplates.map((template, index) => (
            <button
              className="workspace-template-menu-item"
              key={template.id}
              onClick={() => { setOpen(false); onCreateDiagram(template.id); }}
              onKeyDown={(event) => { onItemKeyDown(event, index, template.id); }}
              ref={(element) => { itemRefs.current[index] = element; }}
              role="menuitem"
              tabIndex={index === activeIndex ? 0 : -1}
              type="button"
            >
              <span>{template.label}</span>
              <small>{template.description}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
