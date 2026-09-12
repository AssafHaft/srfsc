import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODE_HASH } from '../../site/config.js';
import { CODE_LENGTH, checkCode, codeFrom } from '../../site/lib/gate.mjs';

test('codeFrom keeps only digits, at most six', () => {
  assert.equal(CODE_LENGTH, 6);
  assert.equal(codeFrom(' 05a08-93 '), '050893');
  assert.equal(codeFrom('0508931'), '050893');
  assert.equal(codeFrom('٠٥'), ''); // only ASCII digits count
  assert.equal(codeFrom(''), '');
});

test('checkCode opens with the configured code and nothing else', async () => {
  assert.equal(await checkCode('050893', CODE_HASH), true);
  assert.equal(await checkCode('050894', CODE_HASH), false);
  assert.equal(await checkCode('05089', CODE_HASH), false);
  assert.equal(await checkCode('', CODE_HASH), false);
});

test('the configured value is a SHA-256 hash, never the code itself', () => {
  assert.match(CODE_HASH, /^[0-9a-f]{64}$/);
});
