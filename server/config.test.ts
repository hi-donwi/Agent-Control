import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, parseConfig } from './config.js';

describe('parseConfig', () => {
  it('defaults to no endpoint and no model', () => {
    assert.deepEqual(parseConfig({}), { config: { defaultProvider: '', defaultModel: '' }, ignoredKeys: [] });
    assert.deepEqual(parseConfig(null).config, { defaultProvider: '', defaultModel: '' });
  });

  it('keeps the default endpoint and model, and drops what is not a string', () => {
    assert.deepEqual(parseConfig({ defaultProvider: 'brain', defaultModel: 'auto' }).config,
      { defaultProvider: 'brain', defaultModel: 'auto' });
    assert.deepEqual(parseConfig({ defaultProvider: 7, defaultModel: ['x'] }).config,
      { defaultProvider: '', defaultModel: '' });
  });

  it('names providers that still hold an API key, and never keeps the key', () => {
    const loaded = parseConfig({
      providers: { openai: { apiKey: 'sk-legacy-openai' }, anthropic: { apiKey: 'sk-ant-legacy' }, google: { apiKey: '' } },
      defaultProvider: 'anthropic',
      defaultModel: 'claude-sonnet-4-20250514',
    });
    assert.deepEqual(loaded.ignoredKeys, ['openai', 'anthropic']);
    assert.doesNotMatch(JSON.stringify(loaded), /sk-legacy-openai|sk-ant-legacy/);
  });
});

describe('loadConfig', () => {
  it('reads nothing and writes nothing when the file is absent', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ac-config-')), 'config.json');
    assert.deepEqual(loadConfig(path).config, { defaultProvider: '', defaultModel: '' });
    assert.equal(existsSync(path), false);
  });

  it('falls back to defaults on a file that is not JSON', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ac-config-')), 'config.json');
    writeFileSync(path, '{not json');
    assert.deepEqual(loadConfig(path).config, { defaultProvider: '', defaultModel: '' });
  });
});
