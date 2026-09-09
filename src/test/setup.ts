import '@testing-library/jest-dom/vitest';

// jsdom does not implement the Clipboard API — provide a stub so components
// that copy addresses/hashes can be exercised in tests.
if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: async () => undefined,
      readText: async () => '',
    },
    configurable: true,
  });
}
