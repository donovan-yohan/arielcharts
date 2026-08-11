export function isSafeMermaidFrontmatter(lines: readonly string[]): boolean {
  const containerIndents = new Set<number>();
  for (const line of lines) {
    if (/\t|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(line)) return false;
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = line.match(/^( *)([A-Za-z_][A-Za-z0-9_-]*):(?: *(.*))?$/u);
    if (!match) return false;
    const indent = match[1]!.length;
    if (indent % 2 !== 0 || (indent > 0 && !containerIndents.has(indent - 2))) return false;
    for (const candidate of [...containerIndents]) {
      if (candidate >= indent) containerIndents.delete(candidate);
    }
    const value = match[3]?.trim() ?? '';
    if (!value) containerIndents.add(indent);
    else if (!isSafeYamlScalar(value)) return false;
  }
  return true;
}

function isSafeYamlScalar(value: string): boolean {
  const brackets: string[] = [];
  let quote: 'single' | 'double' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote === 'single') {
      if (character === "'" && value[index + 1] === "'") index += 1;
      else if (character === "'") quote = null;
      continue;
    }
    if (quote === 'double') {
      if (character === '\\') index += 1;
      else if (character === '"') quote = null;
      continue;
    }
    if (character === '#' && (index === 0 || /\s/u.test(value[index - 1]!))) break;
    if (character === "'") quote = 'single';
    else if (character === '"') quote = 'double';
    else if (character === '[' || character === '{') brackets.push(character);
    else if (character === ']' || character === '}') {
      const open = brackets.pop();
      if ((character === ']' && open !== '[') || (character === '}' && open !== '{')) return false;
    } else if (character === ':' && /\s/u.test(value[index + 1] ?? '')) return false;
    else if (index === 0 && /[,&*!|>%@`]/u.test(character)) return false;
    else if (index === 0 && /[-?:]/u.test(character) && (value.length === 1 || /\s/u.test(value[index + 1]!))) return false;
  }
  return quote === null && brackets.length === 0;
}
