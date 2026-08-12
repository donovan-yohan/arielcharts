import { EXTERNAL_MERMAID_PLUGIN_FAMILIES, getStarterTemplate, type StarterTemplate, type StarterTemplateId } from '@arielcharts/shared';
import React, { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Plus } from 'lucide-react';

const INTERACTIVE_OUTSIDE_TARGET = 'a[href], button, input, select, textarea, [contenteditable="true"], [role="button"], [role="link"], [role="menuitem"], [role="tab"], [tabindex]:not([tabindex="-1"])';

export function getTemplateMenuOrder(templates: readonly StarterTemplate[]): readonly StarterTemplate[] {
  const blank = templates.find((template) => template.id === 'blank');
  return blank ? [blank, ...templates.filter((template) => template.id !== 'blank')] : [...templates];
}

export interface TemplateMenuGroup {
  id: string;
  label: string;
  templates: readonly StarterTemplate[];
}

export function getTemplateMenuGroups(templates: readonly StarterTemplate[]): readonly TemplateMenuGroup[] {
  const ordered = getTemplateMenuOrder(templates);
  const groups = new Map<string, TemplateMenuGroup>();
  for (const template of ordered) {
    const key = template.id === 'blank'
      ? 'start'
      : template.editingModel === 'canvas'
        ? 'canvas'
        : template.stability === 'stable'
          ? 'form-stable'
          : 'form-beta';
    const label = key === 'start'
      ? 'Start'
      : key === 'canvas'
        ? 'Canvas editing · stable'
        : key === 'form-stable'
          ? 'Form editing · stable'
          : 'Form editing · preview';
    const group = groups.get(key);
    if (group) {
      groups.set(key, { ...group, templates: [...group.templates, template] });
    } else {
      groups.set(key, { id: key, label, templates: [template] });
    }
  }
  return [...groups.values()];
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
  if (key === 'Tab') return null;
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
  const templateGroups = getTemplateMenuGroups(templates);
  const externalTemplates = EXTERNAL_MERMAID_PLUGIN_FAMILIES.flatMap((family) => {
    const template = family.availability === 'available-plugin' ? getStarterTemplate(family.id) : undefined;
    return template ? [template] : [];
  });
  const menuTemplates = [...templateGroups.flatMap((group) => group.templates), ...externalTemplates];

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
    const action = getTemplateMenuKeyboardAction(event.key, index, menuTemplates.length);
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
        aria-haspopup="dialog"
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
        <div
          aria-label="Starter templates"
          className="workspace-template-menu"
          id="starter-template-menu"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closeMenu(true);
            }
          }}
          ref={menuRef}
          role="dialog"
        >
          {templateGroups.map((group) => (
            <div aria-label={group.label} className="workspace-template-menu-group" key={group.id} role="group">
              <p className="workspace-template-menu-group-label">{group.label}</p>
              {group.templates.map((template) => {
                const index = menuTemplates.findIndex((candidate) => candidate.id === template.id);
                return (
                  <div className="workspace-template-menu-choice" key={template.id}>
                    <button
                      className="workspace-template-menu-item"
                      data-testid="starter-template-create"
                      onClick={() => { setOpen(false); onCreateDiagram(template.id as StarterTemplateId); }}
                      onKeyDown={(event) => { onItemKeyDown(event, index, template.id as StarterTemplateId); }}
                      ref={(element) => { itemRefs.current[index] = element; }}
                      tabIndex={index === activeIndex ? 0 : -1}
                      type="button"
                    >
                      <span>{template.label}</span>
                      <small>{template.description}</small>
                    </button>
                    {template.helpUrl ? <a aria-label={`Learn about ${template.label} Mermaid syntax`} className="workspace-template-menu-help" href={template.helpUrl} rel="noreferrer" target="_blank">Docs</a> : null}
                  </div>
                );
              })}
            </div>
          ))}
          <div aria-label="External plugins" className="workspace-template-menu-group" role="group">
            <p className="workspace-template-menu-group-label">External plugins</p>
            {EXTERNAL_MERMAID_PLUGIN_FAMILIES.map((family) => {
              const template = externalTemplates.find((candidate) => candidate.id === family.id);
              const index = menuTemplates.findIndex((candidate) => candidate.id === family.id);
              return (
              <div className="workspace-template-menu-choice" key={family.id}>
                {template ? (
                  <button
                    className="workspace-template-menu-item"
                    data-testid="starter-template-create"
                    onClick={() => { setOpen(false); onCreateDiagram(template.id as StarterTemplateId); }}
                    onKeyDown={(event) => { onItemKeyDown(event, index, template.id as StarterTemplateId); }}
                    ref={(element) => { itemRefs.current[index] = element; }}
                    tabIndex={index === activeIndex ? 0 : -1}
                    type="button"
                  >
                    <span>{family.label} · lazy plugin</span>
                    <small>{family.help}</small>
                  </button>
                ) : (
                  <div aria-describedby={`starter-template-${family.id}-help`} aria-disabled="true" className="workspace-template-menu-item is-unavailable">
                    <span>{family.label} · plugin unavailable</span>
                    <small id={`starter-template-${family.id}-help`}>{family.help}</small>
                  </div>
                )}
                <a aria-label={`Learn about ${family.label} Mermaid syntax`} className="workspace-template-menu-help" href={family.helpUrl} rel="noreferrer" target="_blank">Docs</a>
              </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
