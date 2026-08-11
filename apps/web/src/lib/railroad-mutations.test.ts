// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { addRailroadRule, deleteRailroadRule, editRailroadRule, getRailroadDiagramSnapshot, getRailroadRuleIdentity, isRailroadSourceRepresentable, moveRailroadRule, renameRailroadRule } from './railroad-mutations';

const FIXTURES = {
  ir: `railroad-beta
  start = sequence(terminal("x"), nonterminal("next")) ;
  next = choice(terminal("y"), terminal("z")) ;`,
  ebnf: `railroad-ebnf-beta
  start = "x" next ;
  next ::= "y" | "z" ;`,
  abnf: `railroad-abnf-beta
  start = "x" next ;
  next = "y" / "z" ;`,
  peg: `railroad-peg-beta
  start <- "x" next ;
  next <- "y" / "z" ;`,
} as const;

function identity(source: string, index: number) {
  const snapshot = getRailroadDiagramSnapshot(source);
  return getRailroadRuleIdentity(snapshot.rules[index]!, snapshot.rules, snapshot.notation);
}

describe('Railroad source mutations', () => {
  it('accepts and emits the exact Mermaid 11.16.1 safe terminal/nonterminal sequence-and-alternation subset for every dialect', async () => {
    mermaid.initialize({ startOnLoad: false });
    for (const [notation, source] of Object.entries(FIXTURES)) {
      await expect(mermaid.parse(source)).resolves.toBeDefined();
      expect(getRailroadDiagramSnapshot(source)).toMatchObject({ notation, rules: [{ name: 'start' }, { name: 'next' }] });
      const added = addRailroadRule(source, { name: 'tail', definition: notation === 'ir' ? 'terminal("end")' : '"end"' });
      await expect(mermaid.parse(added)).resolves.toBeDefined();
      expect(added.split(/\r\n|\n|\r/u)[0]).toBe(source.split(/\r\n|\n|\r/u)[0]);
    }
  });
  it('renames declaration and parsed nonterminal references atomically without changing the dialect', async () => {
    mermaid.initialize({ startOnLoad: false });
    for (const source of Object.values(FIXTURES)) {
      const renamed = renameRailroadRule(source, identity(source, 1), 'tail');
      expect(renamed).toContain('tail'); expect(renamed).not.toContain('next'); await expect(mermaid.parse(renamed)).resolves.toBeDefined();
    }
  });
  it('edits only verified safe expressions, deletes productions, and reorders rules with positional terminators', async () => {
    mermaid.initialize({ startOnLoad: false });
    for (const [notation, fixture] of Object.entries(FIXTURES)) {
      for (const ending of ['\n', '\r\n', '\r']) {
        const source = fixture.replace(/\n/g, ending); const start = identity(source, 0);
        const definition = notation === 'ir' ? 'choice(terminal("a"), terminal("b"))' : notation === 'abnf' || notation === 'peg' ? '"a" / "b"' : '"a" | "b"';
        const edited = editRailroadRule(source, start, { definition }); expect(edited.match(/\r\n|\n|\r/g)).toEqual(source.match(/\r\n|\n|\r/g)); await expect(mermaid.parse(edited)).resolves.toBeDefined();
        const tail = identity(edited, 1); const moved = moveRailroadRule(edited, tail, 'up'); expect(moved.match(/\r\n|\n|\r/g)).toEqual(edited.match(/\r\n|\n|\r/g)); await expect(mermaid.parse(moved)).resolves.toBeDefined();
        const movedSnapshot = getRailroadDiagramSnapshot(moved); const startIndex = movedSnapshot.rules.findIndex((rule) => rule.name === 'start'); const deleted = deleteRailroadRule(moved, identity(moved, startIndex)); expect(deleted).not.toContain('start'); await expect(mermaid.parse(deleted)).resolves.toBeDefined();
      }
    }
  });
  it('preserves BOM, frontmatter, comments, directives, and source-owned rule spelling', async () => {
    const source = `\uFEFF---\nconfig:\n  theme: neutral\n---\n%%{init: {}}%%\n%% authored note\nrailroad-ebnf-beta\n  title Owned title\n  start ::= "x" next ;\n  next = "y" ;`;
    const renamed = renameRailroadRule(source, identity(source, 1), 'tail');
    expect(renamed.startsWith('\uFEFF---')).toBe(true); expect(renamed).toContain('%% authored note'); expect(renamed).toContain('%%{init: {}}%%'); expect(renamed).toContain('start ::= "x" tail ;');
    mermaid.initialize({ startOnLoad: false }); await expect(mermaid.parse(renamed)).resolves.toBeDefined();
  });
  it('fails closed for advanced or malformed grammar constructs, duplicate declarations, and stale identities', () => {
    expect(isRailroadSourceRepresentable('railroad-beta\n  start = optional(terminal("x")) ;')).toBe(false);
    expect(isRailroadSourceRepresentable('railroad-ebnf-beta\n  start = ("x") ;')).toBe(false);
    expect(isRailroadSourceRepresentable('railroad-abnf-beta\n  start = %x41 ;')).toBe(false);
    expect(isRailroadSourceRepresentable('railroad-peg-beta\n  start <- !word ;')).toBe(false);
    expect(isRailroadSourceRepresentable('railroad-ebnf-beta\n  start = "x" ;\n  start = "y" ;')).toBe(false);
    const start = identity(FIXTURES.ebnf, 0); const remote = FIXTURES.ebnf.replace('"x" next', '"remote" next');
    expect(() => editRailroadRule(remote, start, { definition: '"a"' })).toThrow('changed remotely');
  });

  it('uses Mermaid’s exact case-sensitive headers and metadata, with a BOM accepted only at source offset zero', async () => {
    mermaid.initialize({ startOnLoad: false });
    for (const source of Object.values(FIXTURES)) {
      const [header, ...body] = source.split('\n');
      const badHeader = `${header!.replace('railroad', 'Railroad')}\n${body.join('\n')}`;
      const badMetadata = `${header}\n  Title authored\n${body.join('\n')}`;
      expect(isRailroadSourceRepresentable(badHeader)).toBe(false);
      expect(isRailroadSourceRepresentable(badMetadata)).toBe(false);
      await expect(mermaid.parse(badHeader)).rejects.toBeDefined();
      await expect(mermaid.parse(badMetadata)).rejects.toBeDefined();
      expect(isRailroadSourceRepresentable(`${header}\n  title authored\n${body.join('\n')}`)).toBe(true);
      expect(isRailroadSourceRepresentable(`${header}\n\uFEFF${body.join('\n')}`)).toBe(false);
      expect(isRailroadSourceRepresentable(`\uFEFF${source}`)).toBe(true);
    }
  });

  it('accepts only Mermaid horizontal whitespace and fails closed for indented frontmatter delimiters', async () => {
    mermaid.initialize({ startOnLoad: false });
    for (const source of Object.values(FIXTURES)) {
      const [header, firstRule, ...rest] = source.split('\n');
      const tabbed = `${header}\t\n\t${firstRule!.trim()}\n\t${rest.map((line) => line.trim()).join('\n\t')}`;
      const invalid = [
        ['vertical-tab header', `${header}\v\n${[firstRule, ...rest].join('\n')}`],
        ['form-feed header', `${header}\f\n${[firstRule, ...rest].join('\n')}`],
        ['nonbreaking-space header', `${header}\u00a0\n${[firstRule, ...rest].join('\n')}`],
        ['vertical-tab metadata', `${header}\n  title\vOwned\n${[firstRule, ...rest].join('\n')}`],
        ['vertical-tab rule separator', `${header}\n${firstRule!.replace(/[ \t]+(?:=|::=|<-)[ \t]+/u, '\v$&')}\n${rest.join('\n')}`],
      ];
      expect(isRailroadSourceRepresentable(tabbed)).toBe(true);
      await expect(mermaid.parse(tabbed)).resolves.toBeDefined();
      for (const [label, candidate] of invalid) {
        expect(isRailroadSourceRepresentable(candidate)).toBe(false);
        await mermaid.parse(candidate).then(() => { throw new Error(`${header} accepted ${label}`); }, () => undefined);
      }
      const indentedFrontmatter = `  ---\nconfig:\n  theme: neutral\n  ---\n${source}`;
      expect(isRailroadSourceRepresentable(indentedFrontmatter)).toBe(false);
      await expect(mermaid.parse(indentedFrontmatter)).resolves.toBeDefined();
    }
  });

  it('treats ABNF names as case-insensitive everywhere, while keeping the other dialects case-sensitive', async () => {
    const abnf = `railroad-abnf-beta
  Foo = "x" ;
  use = Foo foo FOO ;`;
    expect(isRailroadSourceRepresentable(`${abnf}\n  foo = "y" ;`)).toBe(false);
    const renamed = renameRailroadRule(abnf, identity(abnf, 0), 'Bar');
    expect(renamed).toBe(`railroad-abnf-beta
  Bar = "x" ;
  use = Bar Bar Bar ;`);
    await expect(mermaid.parse(renamed)).resolves.toBeDefined();
    const caseChanged = abnf.replace('Foo =', 'FOO =');
    expect(editRailroadRule(caseChanged, identity(abnf, 0), { definition: '"z"' })).toContain('FOO = "z" ;');
    expect(isRailroadSourceRepresentable(`${FIXTURES.ebnf}\n  START = "q" ;`)).toBe(true);
  });

  it('accepts quoted semicolons but rejects statement-level semicolons through its tokenizer', async () => {
    const ir = `railroad-beta
  start = terminal("a;b") ;`;
    const ebnf = `railroad-ebnf-beta
  start = "a;b" ;`;
    const abnf = `railroad-abnf-beta
  start = "a;b" ;`;
    const peg = `railroad-peg-beta
  start <- "a;b" ;`;
    for (const source of [ir, ebnf, abnf, peg]) {
      expect(isRailroadSourceRepresentable(source)).toBe(true);
      const definition = source.startsWith('railroad-beta') ? 'terminal("c;d")' : '"c;d"';
      const edited = editRailroadRule(source, identity(source, 0), { definition });
      expect(edited).toContain('c;d');
      expect(addRailroadRule(edited, { name: 'tail', definition: source.startsWith('railroad-beta') ? 'terminal("e;f")' : '"e;f"' })).toContain('e;f');
      await expect(mermaid.parse(edited)).resolves.toBeDefined();
      expect(() => editRailroadRule(source, identity(source, 0), { definition: '"x" ; "y"' })).toThrow('active Mermaid grammar subset');
    }
  });

  it('keeps original final-newline policy and local mixed line endings when adding or deleting', () => {
    const withFinalMixed = 'railroad-ebnf-beta\r\n  start = "x" ;\n';
    const addedFinal = addRailroadRule(withFinalMixed, { name: 'tail', definition: '"y"' });
    expect(addedFinal).toBe('railroad-ebnf-beta\r\n  start = "x" ;\n  tail = "y" ;\n');
    const withoutFinalMixed = 'railroad-ebnf-beta\r\n  start = "x" ;\r  tail = "y" ;';
    const addedNoFinal = addRailroadRule(withoutFinalMixed, { name: 'end', definition: '"z"' });
    expect(addedNoFinal).toBe('railroad-ebnf-beta\r\n  start = "x" ;\r  tail = "y" ;\r  end = "z" ;');
    expect(deleteRailroadRule(withoutFinalMixed, identity(withoutFinalMixed, 1))).toBe('railroad-ebnf-beta\r\n  start = "x" ;');
    expect(deleteRailroadRule(withFinalMixed, identity(withFinalMixed, 0))).toBe('railroad-ebnf-beta\r\n');
  });

  it('renames only declaration/reference token spans without reformatting source-owned spacing or comments', () => {
    const source = 'railroad-ebnf-beta\n%% declaration stays exact\n\tFoo\t::=\t"x"\t;\n  use = Foo\t| "Foo" ;\n%% Foo stays quoted';
    const renamed = renameRailroadRule(source, identity(source, 0), 'Bar');
    expect(renamed).toBe('railroad-ebnf-beta\n%% declaration stays exact\n\tBar\t::=\t"x"\t;\n  use = Bar\t| "Foo" ;\n%% Foo stays quoted');
  });
});
