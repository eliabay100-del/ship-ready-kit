import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * "Test the tests": run the whole audit against the reference fixture site.
 * Cross-platform (no inline env vars, which break on Windows).
 *
 *   npm run test:fixtures
 *   npm run test:fixtures -- tests/02-seo-and-metadata.spec.ts
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const extra = process.argv.slice(2).join(' ');

const env = {
  ...process.env,
  FIXTURE_SITE: '1',
  SITE_URL: 'http://localhost:4173',
  LAUNCH_CONFIG: path.join(here, '..', 'launch.config.fixture.json'),
  REUSE_CRAWL: '0',
};

const child = spawn(`npx playwright test ${extra}`.trim(), {
  cwd: path.join(here, '..'),
  env,
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => process.exit(code ?? 1));
