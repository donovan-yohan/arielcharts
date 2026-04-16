import type { ActivityEvent, ParticipantType } from '@mermaidflow/shared';

export function createActivityEvent(input: {
  action: ActivityEvent['action'];
  actorName: string;
  actorType: ParticipantType;
  detail?: string;
  timestamp?: number;
}): ActivityEvent {
  const timestamp = input.timestamp ?? Date.now();

  return {
    id: crypto.randomUUID(),
    timestamp,
    actor: {
      name: input.actorName,
      type: input.actorType,
    },
    action: input.action,
    detail: input.detail,
  };
}
