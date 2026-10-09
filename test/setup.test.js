import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsLogin, readNamespaceId, configuredId, readSiteUrl, newKey } from '../scripts/setup.mjs';

test('reads what wrangler prints', () => {
  assert.equal(needsLogin('You are not authenticated. Please run `wrangler login`.'), true);
  assert.equal(needsLogin('You are logged in with an OAuth Token'), false);
  assert.equal(readNamespaceId('id = "0123456789abcdef0123456789abcdef"'), '0123456789abcdef0123456789abcdef');
  assert.equal(readSiteUrl('Deployed daily-brief\n  https://daily-brief.lyfesgrocery.workers.dev\n'), 'https://daily-brief.lyfesgrocery.workers.dev');
});

test('knows whether storage is set up', () => {
  assert.equal(configuredId('[[kv_namespaces]]\nbinding = "BRIEFS"\nid = "replace_with_your_kv_namespace_id"'), null);
  assert.equal(configuredId('[[kv_namespaces]]\nbinding = "BRIEFS"\nid = "abc"'), 'abc');
});

test('keys are long and URL-safe', () => {
  const key = newKey();
  assert.equal(key.length, 32);
  assert.match(key, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(newKey(), key);
});
