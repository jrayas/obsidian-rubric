import { defineConfig } from 'vitest/config';

// Mirror esbuild's `text` loader so tests can import the embedded pack.
export default defineConfig({
  plugins: [
    {
      name: 'text-files',
      enforce: 'pre',
      async load(id) {
        if (/\.(yaml|md)$/.test(id)) {
          const { readFileSync } = await import('node:fs');
          return `export default ${JSON.stringify(readFileSync(id, 'utf8'))};`;
        }
        return null;
      },
    },
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
