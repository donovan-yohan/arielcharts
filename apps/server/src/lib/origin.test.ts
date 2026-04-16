import { describe, expect, it } from 'vitest';
import { isOriginAllowed } from './origin.js';

describe('isOriginAllowed', () => {
  it('allows requests with no origin header', () => {
    expect(isOriginAllowed(undefined, ['https://app.example.com'])).toBe(true);
  });

  it('allows all origins when the allow list is empty', () => {
    expect(isOriginAllowed('https://app.example.com', [])).toBe(true);
  });

  it('allows all origins when a wildcard is configured', () => {
    expect(isOriginAllowed('https://app.example.com', ['*'])).toBe(true);
  });

  it('allows explicit origin matches', () => {
    expect(isOriginAllowed('https://app.example.com', ['https://app.example.com'])).toBe(true);
  });

  it('rejects non-matching origins', () => {
    expect(isOriginAllowed('https://evil.example.com', ['https://app.example.com'])).toBe(false);
  });
});
