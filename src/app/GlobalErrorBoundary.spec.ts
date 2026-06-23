import { describe, expect, it } from 'vitest';
import { describeWindowErrorEvent } from './GlobalErrorBoundary';

describe('describeWindowErrorEvent', () => {
  it('keeps message-only window errors from gaining a fake stack', () => {
    const details = describeWindowErrorEvent(
      new ErrorEvent('error', {
        message: 'Script failed.',
        filename: 'https://example.test/app.js',
        lineno: 12,
        colno: 4,
      }),
    );

    expect(details.message).toBe('Script failed.');
    expect(details.stack).toBe('');
    expect(details.filename).toBe('https://example.test/app.js');
    expect(details.lineno).toBe(12);
    expect(details.colno).toBe(4);
  });
});