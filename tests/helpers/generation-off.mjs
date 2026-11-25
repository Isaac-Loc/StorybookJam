/**
 * Turns the app's generation kill switch OFF for the Playwright dev server.
 *
 * Why this exists: specs must never spend credits, but the Worker only sees
 * what `.dev.vars` holds, and the CLI regenerates that file WHOLE (from the
 * app secrets store, which is shared with production) before every dev/test
 * run. Process env is not forwarded to the Worker, and a per-test secrets
 * config would need a non-default CLI flag. So the test server's start command
 * runs this first, appending the switch to the freshly generated file. The
 * next CLI run rewrites the file, so nothing sticks. Production never runs
 * this: it reads the store, where the switch is absent (= generation ON).
 *
 * Set STORYBOOK_REAL_GENERATION=1 to skip it (deliberate real-spend runs only).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const file = new URL('../../.dev.vars', import.meta.url)
if (process.env.STORYBOOK_REAL_GENERATION === '1') {
  console.log('[tests] real generation requested: leaving the kill switch alone')
} else if (existsSync(file)) {
  const kept = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('GENERATION_ENABLED='))
  writeFileSync(file, kept.join('\n').replace(/\n*$/, '\n') + 'GENERATION_ENABLED=false\n')
  console.log('[tests] generation kill switch set OFF for this test server')
} else {
  // Without .dev.vars the Worker has no platform credentials at all, so nothing can be spent.
  console.log('[tests] no .dev.vars found; skipping')
}
