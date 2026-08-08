import type { StarterTemplate, StarterTemplateId } from '@arielcharts/shared';
import { Code2, Pencil, X } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { WorkspaceTemplatePicker } from './workspace-template-picker';

export interface WorkspaceDiagramTab {
  id: string;
  name: string;
}

interface WorkspaceTabStripProps {
  activeDiagramId: string | null;
  diagramModeLabel: string;
  diagramNameDraft: string;
  diagrams: readonly WorkspaceDiagramTab[];
  onActiveDiagramChange: (diagramId: string) => void;
  onCommitDiagramName: () => void;
  onCreateDiagram: (templateId: StarterTemplateId) => void;
  onDeleteDiagram: (diagramId: string) => void;
  onDiagramKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>, diagramId: string) => void;
  onDiagramNameDraftChange: (value: string) => void;
  onRenameDiagram: (diagram: WorkspaceDiagramTab) => void;
  onRenameDismiss: () => void;
  onSourceToggle: (origin: HTMLButtonElement) => void;
  registerTabButton: (diagramId: string, element: HTMLButtonElement | null) => void;
  renamingDiagramId: string | null;
  sourceOpen: boolean;
  starterTemplates: readonly StarterTemplate[];
}

export function WorkspaceTabStrip({
  activeDiagramId,
  diagramModeLabel,
  diagramNameDraft,
  diagrams,
  onActiveDiagramChange,
  onCommitDiagramName,
  onCreateDiagram,
  onDeleteDiagram,
  onDiagramKeyDown,
  onDiagramNameDraftChange,
  onRenameDiagram,
  onRenameDismiss,
  onSourceToggle,
  registerTabButton,
  renamingDiagramId,
  sourceOpen,
  starterTemplates,
}: WorkspaceTabStripProps) {
  return (
    <nav aria-label="Session diagrams" className="workspace-diagram-tabs" data-testid="diagram-tab-bar">
      <div className="workspace-diagram-tab-scroller">
        <div aria-orientation="horizontal" className="workspace-diagram-tab-list" role="tablist">
          {diagrams.map((diagram) => {
          const active = diagram.id === activeDiagramId;
          const renaming = diagram.id === renamingDiagramId;
          return (
            <div className={`workspace-diagram-tab${active ? ' is-active' : ''}`} key={diagram.id} role="presentation">
              {renaming ? (
                <input
                  aria-label="Diagram name"
                  autoFocus
                  className="workspace-diagram-tab-input"
                  onBlur={onCommitDiagramName}
                  onChange={(event) => { onDiagramNameDraftChange(event.target.value); }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') onCommitDiagramName();
                    if (event.key === 'Escape') onRenameDismiss();
                  }}
                  value={diagramNameDraft}
                />
              ) : (
                <button
                  aria-controls="diagram-workspace"
                  aria-selected={active}
                  className="workspace-diagram-tab-button"
                  id={`diagram-tab-${diagram.id}`}
                  onClick={() => { onActiveDiagramChange(diagram.id); }}
                  onDoubleClick={() => { onRenameDiagram(diagram); }}
                  onKeyDown={(event) => { onDiagramKeyDown(event, diagram.id); }}
                  ref={(element) => { registerTabButton(diagram.id, element); }}
                  role="tab"
                  tabIndex={active ? 0 : -1}
                  title={`${diagram.name} (${diagram.id}) — double click to rename`}
                  type="button"
                >
                  {active ? <span aria-hidden="true" className="workspace-tab-active-dot" /> : null}
                  <span>{diagram.name}</span>
                </button>
              )}
              {active && !renaming ? (
                <button
                  aria-label={`Rename ${diagram.name}`}
                  className="workspace-diagram-tab-action workspace-touch-label"
                  data-touch-label="Rename"
                  onClick={() => { onRenameDiagram(diagram); }}
                  type="button"
                ><Pencil aria-hidden="true" size={13} /></button>
              ) : null}
              {active && !renaming && diagrams.length > 1 ? (
                <button aria-label={`Delete ${diagram.name}`} className="workspace-diagram-tab-action workspace-diagram-tab-delete workspace-touch-label" data-touch-label="Delete" onClick={() => { onDeleteDiagram(diagram.id); }} type="button"><X aria-hidden="true" size={14} /></button>
              ) : null}
            </div>
          );
          })}
        </div>
      </div>
      <WorkspaceTemplatePicker onCreateDiagram={onCreateDiagram} templates={starterTemplates} />
      <div className="workspace-diagram-tab-tools">
        <button
          aria-controls="source-flyout"
          aria-expanded={sourceOpen}
          className={`workspace-source-toggle workspace-touch-label${sourceOpen ? ' is-active' : ''}`}
          data-touch-label={sourceOpen ? 'Hide source' : 'Show source'}
          data-testid="source-flyout-toggle"
          onClick={(event) => { onSourceToggle(event.currentTarget); }}
          title="Mermaid source"
          type="button"
        ><Code2 aria-hidden="true" size={15} /><span>{sourceOpen ? 'hide source' : 'show source'}</span></button>
        <span className="workspace-diagram-mode" data-testid="diagram-mode"><span aria-hidden="true" />{diagramModeLabel}</span>
      </div>
    </nav>
  );
}
