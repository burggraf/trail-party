import { describe, expect, it } from 'vitest';
import { cn } from '../../src/lib/utils';

describe('component class overrides', () => {
  it('keeps accessible sizing overrides and conditional theme classes', () => {
    expect(cn('h-9 px-4', 'h-11', false, { 'dark:bg-black': true }))
      .toBe('px-4 h-11 dark:bg-black');
  });
});
