import { Level, type BatchOperation } from 'level';
import type { DiagramRevision, OverlayRevision } from '@arielcharts/shared';
import type { DiagramHistoryMetadata, HistoryPersistenceChange, OverlayHistoryMetadata, RoomAccessRecord, SessionRecord } from './types.js';

const SESSION_KEY_PREFIX = 'session:';
const HISTORY_KEY_PREFIX = 'history:';
const HISTORY_METADATA_KEY_PREFIX = 'history-meta:';
const OVERLAY_HISTORY_KEY_PREFIX = 'overlay-history:';
const OVERLAY_HISTORY_METADATA_KEY_PREFIX = 'overlay-history-meta:';
const ROOM_ACCESS_KEY_PREFIX = 'room-access:';

type PersistedValue = SessionRecord | DiagramRevision | DiagramHistoryMetadata | OverlayRevision | OverlayHistoryMetadata | RoomAccessRecord;

function sequenceKey(sequence: number): string {
  return sequence.toString().padStart(16, '0');
}

export class SessionStore {
  private readonly db: Level<string, PersistedValue>;

  constructor(dataDir: string) {
    this.db = new Level<string, PersistedValue>(dataDir, {
      valueEncoding: 'json',
    });
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    try {
      return (await this.db.get(this.key(sessionId)) as SessionRecord | undefined) ?? null;
    } catch (error) {
      if (this.isNotFound(error)) {
        return null;
      }

      throw error;
    }
  }

  async set(record: SessionRecord): Promise<void> {
    await this.db.put(this.key(record.id), record);
  }

  async getRoomAccess(sessionId: string): Promise<RoomAccessRecord | null> {
    try {
      return (await this.db.get(this.roomAccessKey(sessionId)) as RoomAccessRecord | undefined) ?? null;
    } catch (error) {
      if (this.isNotFound(error)) return null;
      throw error;
    }
  }

  async setRoomAccess(sessionId: string, record: RoomAccessRecord): Promise<void> {
    await this.db.put(this.roomAccessKey(sessionId), record);
  }

  async getHistoryMetadata(sessionId: string, diagramId: string): Promise<DiagramHistoryMetadata | null> {
    try {
      return (await this.db.get(this.historyMetadataKey(sessionId, diagramId)) as DiagramHistoryMetadata | undefined) ?? null;
    } catch (error) {
      if (this.isNotFound(error)) {
        return null;
      }

      throw error;
    }
  }

  async listSessionHistoryMetadata(sessionId: string): Promise<DiagramHistoryMetadata[]> {
    const metadata: DiagramHistoryMetadata[] = [];
    const prefix = `${HISTORY_METADATA_KEY_PREFIX}${sessionId}:`;
    for await (const [, value] of this.db.iterator({ gte: prefix, lte: `${prefix}~` })) {
      metadata.push(value as DiagramHistoryMetadata);
    }
    return metadata;
  }

  async listDiagramHistory(sessionId: string, diagramId: string): Promise<DiagramRevision[]> {
    const revisions: DiagramRevision[] = [];
    const prefix = this.historyKeyPrefix(sessionId, diagramId);

    for await (const [, value] of this.db.iterator({ gte: prefix, lte: `${prefix}~` })) {
      revisions.push(value as DiagramRevision);
    }

    return revisions.sort((left, right) => right.sequence - left.sequence);
  }

  async getDiagramRevision(sessionId: string, diagramId: string, revisionId: string): Promise<DiagramRevision | null> {
    for (const revision of await this.listDiagramHistory(sessionId, diagramId)) {
      if (revision.revision_id === revisionId) {
        return revision;
      }
    }
    return null;
  }

  async listOverlayHistoryMetadata(sessionId: string): Promise<OverlayHistoryMetadata[]> {
    const metadata: OverlayHistoryMetadata[] = [];
    const prefix = `${OVERLAY_HISTORY_METADATA_KEY_PREFIX}${sessionId}:`;
    for await (const [, value] of this.db.iterator({ gte: prefix, lte: `${prefix}~` })) metadata.push(value as OverlayHistoryMetadata);
    return metadata;
  }

  async listOverlayHistory(sessionId: string, diagramId: string): Promise<OverlayRevision[]> {
    const revisions: OverlayRevision[] = [];
    const prefix = this.overlayHistoryKeyPrefix(sessionId, diagramId);
    for await (const [, value] of this.db.iterator({ gte: prefix, lte: `${prefix}~` })) revisions.push(value as OverlayRevision);
    return revisions.sort((left, right) => right.sequence - left.sequence);
  }

  async getOverlayRevision(sessionId: string, diagramId: string, revisionId: string): Promise<OverlayRevision | null> {
    return (await this.listOverlayHistory(sessionId, diagramId)).find((revision) => revision.revision_id === revisionId) ?? null;
  }

  /** Commits the canonical document and every history mutation as one LevelDB batch. */
  async persistWithHistory(
    record: SessionRecord,
    history: HistoryPersistenceChange,
    options: { initialRoomAccess?: RoomAccessRecord } = {},
  ): Promise<boolean> {
    if (options.initialRoomAccess && await this.get(record.id)) {
      return false;
    }
    const operations: Array<BatchOperation<Level<string, PersistedValue>, string, PersistedValue>> = [
      { type: 'put', key: this.key(record.id), value: record },
    ];

    if (options.initialRoomAccess) {
      operations.push({ type: 'put', key: this.roomAccessKey(record.id), value: options.initialRoomAccess });
    }

    for (const revision of history.revisions) {
      operations.push({
        type: 'put',
        key: this.historyKey(record.id, revision.diagram_id, revision.sequence),
        value: revision,
      });
    }

    for (const metadata of history.metadata) {
      operations.push({ type: 'put', key: this.historyMetadataKey(metadata.sessionId, metadata.diagramId), value: metadata });
    }

    for (const target of history.deleteSequences) {
      operations.push({ type: 'del', key: this.historyKey(target.sessionId, target.diagramId, target.sequence) });
    }

    for (const target of history.deleteDiagramHistory) {
      for await (const key of this.db.keys({
        gte: this.historyKeyPrefix(target.sessionId, target.diagramId),
        lte: `${this.historyKeyPrefix(target.sessionId, target.diagramId)}~`,
      })) {
        operations.push({ type: 'del', key });
      }
      operations.push({ type: 'del', key: this.historyMetadataKey(target.sessionId, target.diagramId) });
    }

    for (const revision of history.overlayRevisions) {
      operations.push({ type: 'put', key: this.overlayHistoryKey(record.id, revision.diagram_id, revision.sequence), value: revision });
    }
    for (const metadata of history.overlayMetadata) {
      operations.push({ type: 'put', key: this.overlayHistoryMetadataKey(metadata.sessionId, metadata.diagramId), value: metadata });
    }
    for (const target of history.deleteOverlaySequences) {
      operations.push({ type: 'del', key: this.overlayHistoryKey(target.sessionId, target.diagramId, target.sequence) });
    }
    for (const target of history.deleteOverlayHistory) {
      for await (const key of this.db.keys({
        gte: this.overlayHistoryKeyPrefix(target.sessionId, target.diagramId),
        lte: `${this.overlayHistoryKeyPrefix(target.sessionId, target.diagramId)}~`,
      })) operations.push({ type: 'del', key });
      operations.push({ type: 'del', key: this.overlayHistoryMetadataKey(target.sessionId, target.diagramId) });
    }

    await this.db.batch(operations);
    return true;
  }

  async list(): Promise<SessionRecord[]> {
    const records: SessionRecord[] = [];

    for await (const [, value] of this.db.iterator({ gte: SESSION_KEY_PREFIX, lte: `${SESSION_KEY_PREFIX}~` })) {
      records.push(value as SessionRecord);
    }

    return records.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async delete(sessionId: string): Promise<void> {
    const operations: Array<BatchOperation<Level<string, PersistedValue>, string, PersistedValue>> = [
      { type: 'del', key: this.key(sessionId) },
      { type: 'del', key: this.roomAccessKey(sessionId) },
    ];
    for await (const key of this.db.keys({ gte: `${HISTORY_KEY_PREFIX}${sessionId}:`, lte: `${HISTORY_KEY_PREFIX}${sessionId}:~` })) {
      operations.push({ type: 'del', key });
    }
    for await (const key of this.db.keys({ gte: `${HISTORY_METADATA_KEY_PREFIX}${sessionId}:`, lte: `${HISTORY_METADATA_KEY_PREFIX}${sessionId}:~` })) {
      operations.push({ type: 'del', key });
    }
    for await (const key of this.db.keys({ gte: `${OVERLAY_HISTORY_KEY_PREFIX}${sessionId}:`, lte: `${OVERLAY_HISTORY_KEY_PREFIX}${sessionId}:~` })) operations.push({ type: 'del', key });
    for await (const key of this.db.keys({ gte: `${OVERLAY_HISTORY_METADATA_KEY_PREFIX}${sessionId}:`, lte: `${OVERLAY_HISTORY_METADATA_KEY_PREFIX}${sessionId}:~` })) operations.push({ type: 'del', key });
    await this.db.batch(operations);
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  private key(sessionId: string): string {
    return `${SESSION_KEY_PREFIX}${sessionId}`;
  }

  private historyKeyPrefix(sessionId: string, diagramId: string): string {
    return `${HISTORY_KEY_PREFIX}${sessionId}:${diagramId}:`;
  }

  private historyKey(sessionId: string, diagramId: string, sequence: number): string {
    return `${this.historyKeyPrefix(sessionId, diagramId)}${sequenceKey(sequence)}`;
  }

  private historyMetadataKey(sessionId: string, diagramId: string): string {
    return `${HISTORY_METADATA_KEY_PREFIX}${sessionId}:${diagramId}`;
  }

  private roomAccessKey(sessionId: string): string {
    return `${ROOM_ACCESS_KEY_PREFIX}${sessionId}`;
  }

  private overlayHistoryKeyPrefix(sessionId: string, diagramId: string): string {
    return `${OVERLAY_HISTORY_KEY_PREFIX}${sessionId}:${diagramId}:`;
  }

  private overlayHistoryKey(sessionId: string, diagramId: string, sequence: number): string {
    return `${this.overlayHistoryKeyPrefix(sessionId, diagramId)}${sequenceKey(sequence)}`;
  }

  private overlayHistoryMetadataKey(sessionId: string, diagramId: string): string {
    return `${OVERLAY_HISTORY_METADATA_KEY_PREFIX}${sessionId}:${diagramId}`;
  }

  private isNotFound(error: unknown): boolean {
    if (!error || typeof error !== 'object' || !("code" in error)) {
      return false;
    }

    return (error as { code?: string }).code === 'LEVEL_NOT_FOUND';
  }
}
