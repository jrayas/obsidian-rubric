import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
  globalIgnores([
    'node_modules',
    '.tools',
    'dev',
    'dist',
    'coverage',
    'esbuild.config.mjs',
    'version-bump.mjs',
    'versions.json',
    'main.js',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'scripts',
    'eslint.config.mts',
    'vitest.config.ts',
    'schema-pack',
    'docs',
    'tracking',
  ]),
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.mts', 'manifest.json', 'vitest.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.json'],
      },
    },
  },
  ...obsidianmd.configs.recommended,
  {
    // The tests run in Node and are never part of the plugin bundle, so the rule that keeps Node modules out of a
    // mobile-capable plugin applies to src/ only.
    files: ['tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'obsidianmd/no-nodejs-modules': 'off' },
  },
);
