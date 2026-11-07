import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../../../../.github/workflows/ci.yml', import.meta.url), 'utf8');

describe('hosted browser prerequisites', () => {
  for (const job of ['workspace-ux', 'protected-collaboration']) {
    it(`pins ${job} to a runner supported by the locked Playwright release`, () => {
      const section = workflow.split(`  ${job}:\n`)[1]?.split(/\n  [a-z][a-z-]+:\n/)[0];
      expect(section).toContain('runs-on: ubuntu-24.04');
      expect(section).toContain('pnpm exec playwright install --with-deps chromium');
    });
  }
});
