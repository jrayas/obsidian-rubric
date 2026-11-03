// Write a text file, read it back and try again if it is not what was written. Pure: the file system is injected.
//
// Why: on Android, Obsidian's file adapter now and then leaves a file empty even though `write` finished without
// an error (seen about once in 300 writes on an emulator; the file stayed empty). A schema file that is empty makes
// the whole schema fail to load ("A module file must be a map"). Reading the file back and writing again fixes it
// (600 writes, one retry, no bad files). The check is cheap, so it runs on every platform.

export interface TextFiles {
  write(path: string, text: string): Promise<void>;
  read(path: string): Promise<string>;
}

/** Tries before giving up. */
export const WRITE_ATTEMPTS = 4;

/** Pause before the next try, growing each time. */
export const retryDelayMs = (failedAttempts: number): number => 50 * failedAttempts;

/**
 * Writes `text` to `path` and returns how many extra tries were needed (0 when the first write was fine).
 * Throws when the file still does not match after `attempts` tries, so the caller can tell the person instead of
 * leaving a broken file behind unnoticed.
 */
export async function writeVerified(
  files: TextFiles,
  path: string,
  text: string,
  wait: (ms: number) => Promise<void>,
  attempts: number = WRITE_ATTEMPTS,
): Promise<number> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await files.write(path, text);
    let back: string | null;
    try {
      back = await files.read(path);
    } catch {
      back = null;
    }
    if (back === text) return attempt - 1;
    if (attempt < attempts) await wait(retryDelayMs(attempt));
  }
  throw new Error(`Could not save ${path}: the file did not match what was written after ${attempts} tries.`);
}
