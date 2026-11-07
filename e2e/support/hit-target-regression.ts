import type { Browser, Page } from '@playwright/test';
import { assert } from './assert.ts';
import { assertHitTarget, assertTouchTarget, verifiedClick } from './interactions.ts';

type Receipt = { trusted: boolean; settled: boolean; target: string; x: number; y: number };
type FixtureState = { settled: boolean; clicks: Receipt[] };

async function installFixture(page: Page, content: string): Promise<void> {
  await page.setContent(`<style>
    body { margin: 0; }
    #target { position: fixed; left: 20px; top: 20px; width: 80px; height: 48px; }
    #cover { position: fixed; inset: 0; background: black; z-index: 2; }
  </style>${content}`);
  await page.evaluate(() => {
    const state: FixtureState = { settled: false, clicks: [] };
    Object.assign(window, { pointerRegression: state });
    document.addEventListener('click', (event) => state.clicks.push({
      trusted: event.isTrusted, settled: state.settled,
      target: (event.target as Element).tagName, x: event.clientX, y: event.clientY,
    }));
  });
}

function readState(page: Page): Promise<FixtureState> {
  return page.evaluate(() => (window as unknown as { pointerRegression: FixtureState }).pointerRegression);
}

function markSettled(page: Page): Promise<void> {
  return page.evaluate(() => { (window as unknown as { pointerRegression: FixtureState }).pointerRegression.settled = true; });
}

/** Product-free native pointer regression, run only after the browser install step. */
export async function runHitTargetRegression(browser: Browser): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 640, height: 480 } });
  try {
    const page = await context.newPage();
    await installFixture(page, '<button id="target"><svg width="40" height="30"><rect width="40" height="30" fill="red" /></svg></button><div id="cover"></div>');
    const initial = await page.evaluate(() => {
      const rect = document.querySelector('#target')!.getBoundingClientRect();
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.id;
    });
    assert(initial === 'cover', 'Settlement regression did not begin with a real native cover.');
    await page.evaluate(() => {
      const target = document.querySelector('#target')!;
      const animation = target.animate([{ left: '20px' }, { left: '260px' }], { duration: 500, fill: 'forwards' });
      void animation.finished.then(() => {
        document.querySelector('#cover')!.remove();
        (window as unknown as { pointerRegression: FixtureState }).pointerRegression.settled = true;
      });
    });
    await verifiedClick(page, page.locator('#target'), 'transient native source control');
    const state = await readState(page);
    assert(state.settled && state.clicks.length === 1 && state.clicks[0]?.trusted && state.clicks[0]?.settled,
      `Native settlement must precede exactly one trusted click: ${JSON.stringify(state)}.`);
    assert(state.clicks[0].target === 'rect' && state.clicks[0].x === 300 && state.clicks[0].y === 44,
      `Click did not reach the native SVG descendant at the exact settled center: ${JSON.stringify(state)}.`);
    console.log(`PASS hit-target transient settlement: ${JSON.stringify(state)}`);

    await installFixture(page, '<svg id="target" viewBox="0 0 80 48"><rect width="80" height="48" fill="red" /></svg>');
    await markSettled(page);
    await verifiedClick(page, page.locator('#target'), 'native SVG target');
    assert((await readState(page)).clicks.length === 1, 'Direct SVG target did not receive one native click.');

    await installFixture(page, '<label style="display:block;position:fixed;left:20px;top:20px;width:180px;height:48px"><input id="choice" type="checkbox">Native choice</label>');
    await assertTouchTarget(page, page.locator('#choice'), 'native wrapping choice label');
    await verifiedClick(page, page.locator('label'), 'native wrapping choice label');
    assert(await page.locator('#choice').isChecked(), 'Native wrapping label did not activate its input.');
    console.log('PASS hit-target native SVG and associated label support');

    await installFixture(page, `<section data-workspace-panel="semantic" style="position:fixed;left:20px;top:20px;width:240px;height:150px;overflow-y:auto">
      <div style="height:500px"></div><button id="target" style="position:static">Last source action</button>
    </section>`);
    await markSettled(page);
    await verifiedClick(page, page.locator('#target'), 'semantic source control');
    const scroll = await page.evaluate(() => ({ panel: document.querySelector('section')!.scrollTop, document: window.scrollY }));
    assert(scroll.panel > 0 && scroll.document === 0 && (await readState(page)).clicks.length === 1,
      `Semantic source setup did not preserve its owner route: ${JSON.stringify(scroll)}.`);
    console.log(`PASS hit-target semantic source scroll: ${JSON.stringify(scroll)}`);

    const refusals = [
      { name: 'persistent cover', html: '<button id="target">Blocked</button><div id="cover"></div>', field: '"matches":false' },
      { name: 'hidden target', html: '<button id="target" style="visibility:hidden">Hidden</button>', field: '"visible":false' },
      { name: 'zero bounds', html: '<button id="target" style="width:0;height:0;padding:0;border:0;font-size:0"></button>', field: '"width":0' },
      { name: 'offscreen target', html: '<button id="target" style="left:800px">Offscreen</button>', field: '"contained":false' },
      { name: 'partial offscreen target', html: '<button id="target" style="left:-10px">Partial</button>', field: '"contained":false' },
      { name: 'disabled target', html: '<button id="target" disabled>Disabled</button>', field: '"enabled":false' },
      { name: 'replaced target', html: '<button id="target">Original</button><div id="cover"></div>', field: '"identity":false' },
    ];
    await Promise.all(refusals.map(async ({ name, html, field }) => {
      const refusalPage = await context.newPage();
      try {
        await installFixture(refusalPage, html);
        if (name === 'replaced target') {
          await refusalPage.evaluate(() => {
            const cover = document.querySelector('#cover')!;
            const animation = cover.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 250 });
            void animation.finished.then(() => {
              const original = document.querySelector('#target')!;
              original.replaceWith(original.cloneNode(true));
              cover.remove();
            });
          });
        }
        const started = performance.now();
        let refusal = '';
        try { await verifiedClick(refusalPage, refusalPage.locator('#target'), name); }
        catch (error) { refusal = String(error); }
        const elapsedMs = performance.now() - started;
        const receipts = await readState(refusalPage);
        assert(refusal.includes('native hit-target readiness refused') && refusal.includes(field),
          `${name} did not refuse with native diagnostic metadata: ${refusal}.`);
        // Scheduler/IPC slack is not an extra driver allowance; all polls share 15s.
        assert(elapsedMs < 17_000, `${name} enlarged the original 15s allowance: ${elapsedMs}ms.`);
        assert(receipts.clicks.length === 0, `${name} dispatched a click: ${JSON.stringify(receipts)}.`);
        assert(await refusalPage.evaluate(() => window.scrollX === 0 && window.scrollY === 0), `${name} manufactured viewport arrival.`);
        console.log(`PASS hit-target refusal ${name}: ${JSON.stringify({ elapsedMs: Math.round(elapsedMs), refusal, clicks: receipts.clicks.length })}`);
      } finally {
        await refusalPage.close();
      }
    }));

    // The real trial action moves the pointer but dispatches no click. Change
    // geometry at that native boundary to prove readiness cannot cache admission.
    await installFixture(page, '<button id="target">Late movement</button>');
    await page.mouse.move(600, 400);
    await page.evaluate(() => {
      document.querySelector('#target')!.addEventListener('pointerover', () => {
        (document.querySelector('#target') as HTMLElement).style.left = '260px';
      }, { once: true });
    });
    let lateRefusal = '';
    try { await verifiedClick(page, page.locator('#target'), 'post-readiness movement'); }
    catch (error) { lateRefusal = String(error); }
    assert(lateRefusal.includes('failed fresh native point admission') && (await readState(page)).clicks.length === 0,
      `Final fresh geometry admission was bypassed: ${lateRefusal}.`);
    console.log(`PASS hit-target final fresh geometry refusal: ${lateRefusal}`);

    for (const mutation of ['cover', 'replace'] as const) {
      await installFixture(page, '<button id="target">Late ownership change</button>');
      await page.mouse.move(600, 400);
      await page.evaluate((kind) => {
        document.querySelector('#target')!.addEventListener('pointerover', () => {
          if (kind === 'cover') {
            const cover = document.createElement('div');
            cover.id = 'cover';
            document.body.append(cover);
          } else {
            const target = document.querySelector('#target')!;
            target.replaceWith(target.cloneNode(true));
          }
        }, { once: true });
      }, mutation);
      let refusal = '';
      try { await verifiedClick(page, page.locator('#target'), `post-readiness ${mutation}`); }
      catch (error) { refusal = String(error); }
      const expected = mutation === 'cover' ? '"matches":false' : '"identity":false';
      const finalGateRefused = refusal.includes('failed fresh native point admission') && refusal.includes(expected);
      const nativeTrialRefused = refusal.includes('native pointer trial refused')
        && refusal.includes(mutation === 'cover' ? 'intercepts pointer events' : 'not attached');
      assert((finalGateRefused || nativeTrialRefused) && (await readState(page)).clicks.length === 0,
        `Final current-target/center admission was bypassed after ${mutation}: ${refusal}.`);
      console.log(`PASS hit-target final/native ${mutation} refusal: ${refusal}`);
    }

    await installFixture(page, '<button id="target">Observation only</button>');
    await assertHitTarget(page, page.locator('#target'), 'read-only target observation');
    assert((await readState(page)).clicks.length === 0, 'Readiness observation dispatched a click.');
    console.log('PASS hit-target readiness remains read-only');
  } finally {
    // Bound fixture cleanup independently of the readiness allowance.
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        context.close(),
        new Promise<never>((_, reject) => { cleanupTimer = setTimeout(() => reject(new Error('Hit-target fixture cleanup exceeded 5s.')), 5_000); }),
      ]);
    } finally {
      clearTimeout(cleanupTimer);
    }
  }
}
