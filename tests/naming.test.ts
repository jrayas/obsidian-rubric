import { describe, expect, it } from 'vitest';
import { isDefaultNoteName, stillBeingNamed } from '../src/core/naming';

describe('default note names', () => {
  it('recognises Obsidian’s default name with and without a number, in several languages', () => {
    for (const n of ['Untitled', 'Untitled 1', 'untitled 12', 'Sans titre', 'Unbenannt 2', 'Sin título', 'Sin titulo', '无标题', '無題', 'Без названия 3']) {
      expect(isDefaultNoteName(n), n).toBe(true);
    }
  });

  it('does not treat a real name as the default', () => {
    for (const n of ['Wave', 'Untitled idea', 'My Untitled', 'Untitled-1', 'Note 2', '']) expect(isDefaultNoteName(n), n).toBe(false);
  });
});

describe('is the user still naming the note?', () => {
  it('yes while the title has focus, or while the open note still has the default name', () => {
    expect(stillBeingNamed({ isActive: true, titleFocused: true, basename: 'Wav' })).toBe(true);
    expect(stillBeingNamed({ isActive: true, titleFocused: false, basename: 'Untitled' })).toBe(true);
  });

  it('no once the note has a real name and the title is not focused, or the note is not the open one', () => {
    expect(stillBeingNamed({ isActive: true, titleFocused: false, basename: 'Wave' })).toBe(false);
    expect(stillBeingNamed({ isActive: false, titleFocused: true, basename: 'Untitled' })).toBe(false);
  });
});
