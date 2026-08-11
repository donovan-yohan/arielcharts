// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
  addPacketField,
  deletePacketField,
  editPacketField,
  getPacketDiagramSnapshot,
  getPacketFieldIdentity,
  isPacketSourceRepresentable,
  movePacketField,
  resolvePacketField,
  type PacketFieldIdentity,
} from './packet-mutations';

const SOURCE = `\uFEFF---
title: Transport header
---
%% authored packet note
packet-beta
  0: "Version"
  1-3: 'Flags'
  4-7: "Length"`;

function identity(source: string, index: number): PacketFieldIdentity {
  const snapshot = getPacketDiagramSnapshot(source);
  return getPacketFieldIdentity(snapshot.fields[index]!, snapshot.fields);
}

async function expectPacketParse(source: string): Promise<void> {
  await expect(mermaid.parse(source)).resolves.toMatchObject({ diagramType: 'packet' });
}

describe('Packet source mutations', () => {
  it('snapshots the exact packet-beta absolute-field subset and parses every emitted operation with Mermaid 11.16.1', async () => {
    mermaid.initialize({ startOnLoad: false });
    expect(getPacketDiagramSnapshot(SOURCE)).toEqual({ fields: [
      { start: 0, end: 0, label: 'Version' },
      { start: 1, end: 3, label: 'Flags' },
      { start: 4, end: 7, label: 'Length' },
    ] });
    await expectPacketParse(SOURCE);

    const added = addPacketField(SOURCE, { start: 8, end: 9, label: 'Payload "kind"' });
    expect(added).toContain('8-9: "Payload \\"kind\\""');
    await expectPacketParse(added);

    const edited = editPacketField('packet-beta\n0-2: "Header"', identity('packet-beta\n0-2: "Header"', 0), {
      start: 0,
      end: 3,
      label: 'Wide header',
    });
    expect(edited).toBe('packet-beta\n0-3: "Wide header"');
    await expectPacketParse(edited);

    const moved = movePacketField(SOURCE, identity(SOURCE, 2), 'up');
    expect(getPacketDiagramSnapshot(moved).fields).toEqual([
      { start: 0, end: 0, label: 'Version' },
      { start: 1, end: 4, label: 'Length' },
      { start: 5, end: 7, label: 'Flags' },
    ]);
    await expectPacketParse(moved);

    const deleted = deletePacketField(SOURCE, identity(SOURCE, 1));
    expect(getPacketDiagramSnapshot(deleted).fields).toEqual([
      { start: 0, end: 0, label: 'Version' },
      { start: 1, end: 4, label: 'Length' },
    ]);
    await expectPacketParse(deleted);
  });

  it('validates safe integer boundaries, absolute ordering, overlap, reversal, and Mermaid contiguity', () => {
    expect(isPacketSourceRepresentable('packet-beta\n0: "A"\n1-3: "B"')).toBe(true);
    expect(isPacketSourceRepresentable('packet-beta\n1: "Starts late"')).toBe(false);
    expect(isPacketSourceRepresentable('packet-beta\n0-2: "A"\n2-3: "Overlap"')).toBe(false);
    expect(isPacketSourceRepresentable('packet-beta\n0-3: "A"\n2: "Reverse order"')).toBe(false);
    expect(isPacketSourceRepresentable('packet-beta\n0: "A"\n2: "Gap"')).toBe(false);
    expect(isPacketSourceRepresentable('packet-beta\n3-1: "Reversed"')).toBe(false);
    expect(isPacketSourceRepresentable(`packet-beta\n${Number.MAX_SAFE_INTEGER + 1}: "Unsafe start"`)).toBe(false);
    expect(() => addPacketField('packet-beta\n0: "A"', { start: 2, end: 2, label: 'Gap' })).toThrow('start at bit 1');
    expect(() => editPacketField('packet-beta\n0-1: "A"\n2-3: "B"', identity('packet-beta\n0-1: "A"\n2-3: "B"', 0), { end: 2 })).toThrow('contiguous');
  });

  it('fails closed for aliases, relative fields, configuration, directives, labels, and unfamiliar valid syntax', () => {
    expect(isPacketSourceRepresentable('packet\n0: "Alias"')).toBe(false);
    expect(isPacketSourceRepresentable('Packet-beta\n0: "Case"')).toBe(false);
    expect(isPacketSourceRepresentable(' packet-beta\n0: "Indented header"')).toBe(false);
    expect(isPacketSourceRepresentable('packet-beta \n0: "Trailing header space"')).toBe(false);
    expect(isPacketSourceRepresentable('packet-beta\n+2: "Relative"')).toBe(false);
    expect(isPacketSourceRepresentable('%%{init: { "packet": { "bitsPerRow": 8 } }}%%\npacket-beta\n0: "Configured"')).toBe(false);
    expect(isPacketSourceRepresentable('---\nconfig:\n  packet:\n    bitsPerRow: 8\n---\npacket-beta\n0: "Configured"')).toBe(false);
    expect(isPacketSourceRepresentable('packet-beta\ntitle Packet title\n0: "A"')).toBe(false);
    expect(isPacketSourceRepresentable('packet-beta\n0: unquoted')).toBe(false);
    expect(isPacketSourceRepresentable('packet-beta\n0: ""')).toBe(true);
    expect(isPacketSourceRepresentable('packet-beta\n0: " line padded "')).toBe(true);
    expect(isPacketSourceRepresentable('packet-beta\n0: "escaped\\nline"')).toBe(false);
    expect(isPacketSourceRepresentable('packet-beta\n0: "A" %% inline')).toBe(false);
    expect(isPacketSourceRepresentable('packet-beta\n0: "A"\u000b')).toBe(false);
    expect(isPacketSourceRepresentable('packet-beta\n0: "A"\n\uFEFF1: "B"')).toBe(false);
  });

  it('rejects malformed and indicator-leading YAML frontmatter that pinned Mermaid rejects without writes', async () => {
    mermaid.initialize({ startOnLoad: false });
    for (const malformed of [
      '---\ntitle: [unterminated\n---\npacket-beta\n0: "A"',
      '---\ntitle: ,leading comma\n---\npacket-beta\n0: "A"',
      '---\ntitle: %leading percent\n---\npacket-beta\n0: "A"',
      '---\ntitle: - leading dash\n---\npacket-beta\n0: "A"',
      '---\ntitle: ? leading question\n---\npacket-beta\n0: "A"',
      '---\ntitle: : leading colon\n---\npacket-beta\n0: "A"',
    ]) {
      expect(isPacketSourceRepresentable(malformed)).toBe(false);
      let attempted = malformed;
      expect(() => {
        attempted = addPacketField(malformed, { start: 1, end: 1, label: 'B' });
      }).toThrow('not a safely representable');
      expect(attempted).toBe(malformed);
      await expect(mermaid.parse(malformed)).rejects.toThrow();
    }
  });

  it('uses stable unique semantic fingerprints after remote range shifts and fails stale after edits or duplicates', async () => {
    const original = identity(SOURCE, 1);
    const remoteShift = SOURCE
      .replace('0: "Version"', '0-1: "Version"')
      .replace("1-3: 'Flags'", "2-4: 'Flags'")
      .replace('4-7: "Length"', '5-8: "Length"');
    expect(resolvePacketField(remoteShift, original)).toEqual({ start: 2, end: 4, label: 'Flags' });
    const editedAfterShift = editPacketField(remoteShift, original, { label: 'Control flags' });
    expect(editedAfterShift).toContain('2-4: "Control flags"');
    await expectPacketParse(editedAfterShift);

    const remoteEdit = SOURCE.replace("1-3: 'Flags'", '1-3: "Remote flags"');
    expect(() => resolvePacketField(remoteEdit, original)).toThrow('changed remotely');
    const duplicateSource = 'packet-beta\n0: "Reserved"\n1: "Reserved"';
    const duplicateSnapshot = getPacketDiagramSnapshot(duplicateSource);
    const duplicateIdentity = getPacketFieldIdentity(duplicateSnapshot.fields[0]!, duplicateSnapshot.fields);
    expect(duplicateIdentity.occurrenceCount).toBe(2);
    expect(() => editPacketField(duplicateSource, duplicateIdentity, { label: 'Ambiguous' })).toThrow('changed remotely');
    expect(() => deletePacketField(duplicateSource, duplicateIdentity)).toThrow('changed remotely');
    expect(() => movePacketField(duplicateSource, duplicateIdentity, 'down')).toThrow('changed remotely');
  });

  it('preserves BOM, frontmatter, standalone comments, untouched bytes, and exact no-op source', () => {
    const edited = editPacketField(SOURCE, identity(SOURCE, 1), { label: 'Control' });
    expect(edited.startsWith('\uFEFF---\ntitle: Transport header\n---')).toBe(true);
    expect(edited).toContain('%% authored packet note');
    expect(edited).toContain('  0: "Version"');
    expect(edited).toContain('  4-7: "Length"');
    expect(editPacketField(SOURCE, identity(SOURCE, 1), { start: 1, end: 3, label: 'Flags' })).toBe(SOURCE);
    expect(movePacketField(SOURCE, identity(SOURCE, 0), 'up')).toBe(SOURCE);
  });

  it('preserves LF, CRLF, CR, mixed positional terminators, and final-newline policy', async () => {
    mermaid.initialize({ startOnLoad: false });
    for (const ending of ['\n', '\r\n', '\r']) {
      const noFinal = ['packet-beta', '0: "A"', '1-2: "B"'].join(ending);
      const added = addPacketField(noFinal, { start: 3, end: 3, label: 'C' });
      expect(added).toBe(`${noFinal}${ending}  3: "C"`);
      expect(added.endsWith(ending)).toBe(false);
      await expectPacketParse(added);
      expect(deletePacketField(added, identity(added, 2))).toBe(noFinal);

      const withFinal = `${noFinal}${ending}`;
      const appended = addPacketField(withFinal, { start: 3, end: 3, label: 'C' });
      expect(appended).toBe(`${withFinal}  3: "C"${ending}`);
      await expectPacketParse(appended);
    }

    const mixed = 'packet-beta\r\n0: "A"\n1-2: "B"\r3: "C"';
    const moved = movePacketField(mixed, identity(mixed, 1), 'down');
    expect(moved).toBe('packet-beta\r\n0: "A"\n1: "C"\r2-3: "B"');
    expect(moved.match(/\r\n|\n|\r/gu)).toEqual(mixed.match(/\r\n|\n|\r/gu));
    expect(moved.endsWith('\r')).toBe(false);
    await expectPacketParse(moved);

    const addedToEmpty = addPacketField('packet-beta', { start: 0, end: 0, label: '' });
    expect(addedToEmpty).toBe('packet-beta\n  0: ""');
    await expectPacketParse(addedToEmpty);
  });
});
