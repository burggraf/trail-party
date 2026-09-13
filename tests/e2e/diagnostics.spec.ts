import { test, expect } from './fixtures';

test('diagnostics can be intentionally exercised without a hidden skip', async () => {
  if (process.env.E2E_FORCE_FAILURE === '1') expect('forced diagnostic failure').toBe('green');
  expect(true).toBe(true);
});
