import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getFormattedTimestamp, sleep } from '../src/utils/time.js';
import { copyDir } from '../src/utils/fs.js';

describe('time utils', () => {
  it('should format timestamp matching YYYYMMDD-HHMMSS format', () => {
    const ts = getFormattedTimestamp(new Date('2026-07-22T12:34:56Z'));
    assert.match(ts, /^\d{8}-\d{6}$/);
  });

  it('sleep should delay execution', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 40);
  });
});

describe('fs utils', () => {
  it('copyDir should copy files and ignore excluded directories and files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'));
    const srcDir = path.join(tmpDir, 'src');
    const destDir = path.join(tmpDir, 'dest');

    fs.mkdirSync(srcDir);
    fs.mkdirSync(path.join(srcDir, 'output-123'));
    fs.mkdirSync(path.join(srcDir, 'test-results-123'));
    fs.mkdirSync(path.join(srcDir, '.git'));
    fs.mkdirSync(path.join(srcDir, 'node_modules'));

    fs.writeFileSync(path.join(srcDir, 'file.txt'), 'hello');
    fs.writeFileSync(path.join(srcDir, 'test-setup.sh'), '#!/bin/bash\necho setup');
    fs.writeFileSync(path.join(srcDir, 'output-123', 'ignored.txt'), 'ignore');

    copyDir(srcDir, destDir);

    assert.ok(fs.existsSync(path.join(destDir, 'file.txt')));
    assert.ok(!fs.existsSync(path.join(destDir, 'output-123')));
    assert.ok(!fs.existsSync(path.join(destDir, 'test-results-123')));
    assert.ok(!fs.existsSync(path.join(destDir, '.git')));
    assert.ok(!fs.existsSync(path.join(destDir, 'node_modules')));
    assert.ok(!fs.existsSync(path.join(destDir, 'test-setup.sh')));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
