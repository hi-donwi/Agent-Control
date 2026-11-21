import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allowlistedChildEnv } from './child-env.js';

describe('allowlistedChildEnv', () => {
  it('keeps only PATH, HOME, LANG, TERM, and WS_* from the source and overrides', () => {
    const env = allowlistedChildEnv({
      PATH: '/safe/bin',
      HOME: '/safe/home',
      LANG: 'en_US.UTF-8',
      TERM: 'xterm-256color',
      WS_AGENT: 'inherited',
      WS_TEST_VALUE: 'kept',
      PAGER: 'less',
      NODE_OPTIONS: '--require unexpected',
      PRIVATE_TEST_VALUE: 'not-inherited',
    }, {
      WS_AGENT: 'agent-control',
      PAGER: 'more',
      PRIVATE_OVERRIDE: 'not-allowed',
    });

    assert.deepEqual(env, {
      PATH: '/safe/bin',
      HOME: '/safe/home',
      LANG: 'en_US.UTF-8',
      TERM: 'xterm-256color',
      WS_AGENT: 'agent-control',
      WS_TEST_VALUE: 'kept',
    });
  });
});
