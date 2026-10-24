import esbuild from 'esbuild';
import process from 'process';
import { builtinModules } from 'node:module';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const prod = process.argv[2] === 'production';

// In watch mode, copy the three release files into a dev vault's plugin folder.
const devPluginDir = process.env.RUBRIC_DEV_DIR;

const copyPlugin = {
  name: 'copy-to-dev-vault',
  setup(build) {
    build.onEnd(() => {
      if (prod || !devPluginDir) return;
      mkdirSync(devPluginDir, { recursive: true });
      for (const f of ['main.js', 'manifest.json', 'styles.css']) {
        if (existsSync(f)) copyFileSync(f, join(devPluginDir, f));
      }
    });
  },
};

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    ...builtinModules,
  ],
  format: 'cjs',
  target: 'es2021',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
  minify: prod,
  plugins: [copyPlugin],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
