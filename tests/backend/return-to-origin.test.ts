import assert from 'node:assert/strict';
import test from 'node:test';

test('return-to-origin', () => {
  const validJoinIntent = '/join?code=ABC123';
  // P01's auth route has no return-to validator or sessionStorage handoff yet. Keep
  // this executable contract red until T2 owns the SPA validation/consume path.
  const observedStoredIntent: string | undefined = undefined;
  assert.equal(observedStoredIntent, validJoinIntent,
    'return-to-origin join-intent-roundtrip: valid relative intent was not preserved in sessionStorage');
});
