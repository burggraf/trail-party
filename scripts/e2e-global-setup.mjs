import { startTestStack } from './test-stack.mjs';

export default async function globalSetup() {
  const stack = await startTestStack();
  process.env.TRAIL_PARTY_E2E_STACK = stack.stackFile;
  return async () => stack.close();
}
