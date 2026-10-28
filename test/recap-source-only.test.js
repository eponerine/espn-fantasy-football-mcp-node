import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

test('Week 7 migration tests run from source only without scripts or Git', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recap-source-only-'));
  try {
    const sources = ['src', 'recap', 'test', 'tests', 'package.json'];
    await Promise.all(sources.map(source => cp(join(root, source), join(directory, source), { recursive: true })));
    await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.deepEqual((await readdir(directory)).sort(), [...sources, 'node_modules'].sort());
    const env = Object.fromEntries(Object.entries(process.env)
      .filter(([key]) => key.toLowerCase() !== 'path' && key !== 'NODE_TEST_CONTEXT'));
    env.PATH = '';
    const { stdout, stderr } = await execFileAsync(process.execPath,
      ['--test', '--test-reporter=tap', 'test/recap-week7-v12.test.js'],
      { cwd: directory, env, timeout: 30_000 });
    assert.match(stdout, /# pass 24\b/);
    assert.match(stdout, /# fail 0\b/);
    assert.equal(stderr, '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});