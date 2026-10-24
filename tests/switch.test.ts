import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/settings';

describe('the master switch', () => {
  it('is off by default, so a fresh install changes nothing until the user turns it on', () => {
    expect(DEFAULT_SETTINGS.enabled).toBe(false);
    expect(mergeSettings(null).enabled).toBe(false);
    expect(mergeSettings(undefined).enabled).toBe(false);
    expect(mergeSettings('not an object').enabled).toBe(false);
  });

  it('stays on for an install whose saved settings predate the switch', () => {
    // data.json written by an earlier version: other settings, no "enabled"
    expect(mergeSettings({ schemaFolder: '_schema', stampModified: true, index: {} }).enabled).toBe(true);
    expect(mergeSettings({}).enabled).toBe(true);
  });

  it('keeps what the user chose', () => {
    expect(mergeSettings({ enabled: true }).enabled).toBe(true);
    expect(mergeSettings({ enabled: false, stampModified: true }).enabled).toBe(false);
  });

  it('ignores a value of the wrong type and falls back to off', () => {
    expect(mergeSettings({ enabled: 'yes' }).enabled).toBe(false);
    expect(mergeSettings({ enabled: 1 }).enabled).toBe(false);
  });

  it('does not touch the other defaults', () => {
    const fresh = mergeSettings(null);
    expect({ ...fresh, enabled: DEFAULT_SETTINGS.enabled }).toEqual({ ...DEFAULT_SETTINGS, skippedFolders: [], retiredIds: [], index: {} });
  });
});
