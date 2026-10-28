import type { BodyGate } from '../../src/core/body-gate';
import type { BodyPorts } from '../../src/core/body-service';
import { BodyService } from '../../src/core/body-service';
import type { ResolvedType } from '../../src/core/schema-types';

export interface FakeFile {
  path: string;
}

/** An in-memory vault: `process` is atomic like Obsidian's (the transform sees the text as it is now). */
export class FakeVault {
  texts = new Map<string, string>();
  /** How many times a transform returned different text (a real write). */
  writes = 0;
  processCalls = 0;
  debug = false;
  logs: string[] = [];
  gate: (f: FakeFile) => BodyGate = () => ({ allowed: true, type: { name: 'task', body: { enabled: true } } as unknown as ResolvedType });
  readOnly = false;
  failWith: string | null = null;
  /** Runs before the transform of the next `process`, to simulate a change made since the caller read. */
  beforeProcess: (() => void) | null = null;

  put(path: string, text: string): FakeFile {
    this.texts.set(path, text);
    return { path };
  }

  ports(): BodyPorts<FakeFile> {
    return {
      read: (f) => Promise.resolve(this.texts.get(f.path) ?? ''),
      process: (f, transform) => {
        this.processCalls++;
        this.beforeProcess?.();
        this.beforeProcess = null;
        if (this.failWith) return Promise.resolve({ error: this.failWith });
        const text = this.texts.get(f.path) ?? '';
        if (this.readOnly) return Promise.resolve({ error: 'newer schema', readOnly: true });
        try {
          const next = transform(text);
          if (next !== text) {
            this.writes++;
            this.texts.set(f.path, next);
          }
          return Promise.resolve({});
        } catch (e) {
          return Promise.resolve({ error: e instanceof Error ? e.message : String(e) });
        }
      },
      gate: (f) => this.gate(f),
      debug: () => this.debug,
      log: (m) => this.logs.push(m),
    };
  }

  service(): BodyService<FakeFile> {
    return new BodyService(this.ports());
  }
}
