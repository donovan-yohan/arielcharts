import { launchBrowserHarness } from './e2e/support/browser.ts';
import { runHitTargetRegression } from './e2e/support/hit-target-regression.ts';

async function main(): Promise<void> {
  const harness = await launchBrowserHarness();
  try {
    await runHitTargetRegression(harness.browser);
  } finally {
    await harness.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
