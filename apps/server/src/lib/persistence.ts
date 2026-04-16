import { Level } from 'level';
import type { SessionRecord } from './types.js';

const SESSION_KEY_PREFIX = 'session:';

export class SessionStore {
  private readonly db: Level<string, SessionRecord>;

  constructor(dataDir: string) {
    this.db = new Level<string, SessionRecord>(dataDir, {
      valueEncoding: 'json',
    });
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    try {
      return await this.db.get(this.key(sessionId));
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

  async list(): Promise<SessionRecord[]> {
    const records: SessionRecord[] = [];

    for await (const [, value] of this.db.iterator({ gte: SESSION_KEY_PREFIX, lte: `${SESSION_KEY_PREFIX}~` })) {
      records.push(value);
    }

    return records.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async delete(sessionId: string): Promise<void> {
    await this.db.del(this.key(sessionId));
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  private key(sessionId: string): string {
    return `${SESSION_KEY_PREFIX}${sessionId}`;
  }

  private isNotFound(error: unknown): boolean {
    if (!error || typeof error !== 'object' || !("code" in error)) {
      return false;
    }

    return (error as { code?: string }).code === 'LEVEL_NOT_FOUND';
  }
}
