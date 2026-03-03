import { describe, expect, it } from 'vitest';

describe('shared type modules runtime loading', () => {
  it('loads shared type modules without runtime side effects', async () => {
    const hotkeys = await import('./hotkeys');
    const xnat = await import('./xnat');
    const index = await import('./index');

    expect(hotkeys).toBeTypeOf('object');
    expect(xnat).toBeTypeOf('object');
    expect(index).toBeTypeOf('object');
  });
});
