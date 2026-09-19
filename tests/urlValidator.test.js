import test from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedAddress } from '../src/security/urlValidator.js';
import { parseSize } from '../src/config.js';

test('blocks loopback, private, and link-local addresses', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fe80::1']) {
    assert.equal(isBlockedAddress(address), true, address);
  }
});

test('allows a public address', () => {
  assert.equal(isBlockedAddress('1.1.1.1'), false);
});

test('parses configured size units', () => {
  assert.equal(parseSize('500MB'), 500 * 1024 * 1024);
  assert.equal(parseSize('2GB'), 2 * 1024 ** 3);
});
