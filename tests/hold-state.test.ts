import { describe, expect, it } from 'vitest';
import { holdStep, isModifierHeld } from '../src/core/hold-state';
import type { HoldInput, HoldState } from '../src/core/hold-state';

/** Run a script of inputs and return the final state plus every effect, in order. */
function run(inputs: HoldInput[], start: HoldState = 'closed') {
  let state = start;
  const effects: string[] = [];
  for (const i of inputs) {
    const r = holdStep(state, i);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}
const down: HoldInput = { type: 'holdDown', repeat: false };
const repeat: HoldInput = { type: 'holdDown', repeat: true };
const up = (over = false, alwaysHide = false): HoldInput => ({ type: 'holdUp', pointerOverList: over, alwaysHide });
const timer: HoldInput = { type: 'timer' };
const hotkey: HoldInput = { type: 'hotkey' };
const esc: HoldInput = { type: 'escape' };
const other: HoldInput = { type: 'otherKey' };
const click: HoldInput = { type: 'clickElsewhere' };

describe('hold the key to show all options', () => {
  it('shows the list only after the delay', () => {
    expect(run([down])).toEqual({ state: 'pending', effects: ['startTimer'] });
    expect(run([down, timer])).toEqual({ state: 'hold', effects: ['startTimer', 'show'] });
  });

  it('ignores key auto-repeat', () => {
    expect(run([down, repeat, repeat, timer]).effects).toEqual(['startTimer', 'show']);
  });

  it('releasing before the delay cancels it and never shows the list', () => {
    expect(run([down, up()])).toEqual({ state: 'closed', effects: ['startTimer', 'cancelTimer'] });
  });

  it('another key during the hold cancels it (Option+G types a symbol)', () => {
    expect(run([down, other, timer])).toEqual({ state: 'closed', effects: ['startTimer', 'cancelTimer'] });
  });

  it('once open by holding, other keys do nothing', () => {
    expect(run([down, timer, other])).toEqual({ state: 'hold', effects: ['startTimer', 'show'] });
  });

  it('release hides the list at once when the pointer is off it', () => {
    expect(run([down, timer, up(false)]).state).toBe('closed');
    expect(run([down, timer, up(false)]).effects).toEqual(['startTimer', 'show', 'hide']);
  });

  it('release keeps the list when the pointer is over it, until click elsewhere or Escape', () => {
    const over = run([down, timer, up(true)]);
    expect(over.state).toBe('sticky');
    expect(over.effects).toEqual(['startTimer', 'show']);
    expect(run([down, timer, up(true), click])).toMatchObject({ state: 'closed', effects: ['startTimer', 'show', 'hide'] });
    expect(run([down, timer, up(true), esc])).toMatchObject({ state: 'closed', effects: ['startTimer', 'show', 'hide', 'consumeEscape'] });
  });

  it('the "always hide" setting hides on release even over the list', () => {
    expect(run([down, timer, up(true, true)]).state).toBe('closed');
  });
});

describe('latched list from the hotkey', () => {
  it('opens and stays open', () => {
    expect(run([hotkey])).toEqual({ state: 'latched', effects: ['show'] });
    expect(run([hotkey, up(true), other]).state).toBe('latched');
  });

  it('the same hotkey closes it', () => {
    expect(run([hotkey, hotkey])).toEqual({ state: 'closed', effects: ['show', 'hide'] });
  });

  it('Escape closes only the list; a second Escape is not consumed', () => {
    const first = run([hotkey, esc]);
    expect(first).toEqual({ state: 'closed', effects: ['show', 'hide', 'consumeEscape'] });
    expect(holdStep('closed', esc)).toEqual({ state: 'closed', effects: [] });
  });

  it('holding then pressing the hotkey latches the list and it survives release', () => {
    const r = run([down, timer, hotkey, up(false)]);
    expect(r.state).toBe('latched');
    expect(r.effects).toEqual(['startTimer', 'show']); // no second show, no hide
  });

  it('pressing the hotkey while still waiting for the delay latches immediately', () => {
    expect(run([down, hotkey])).toEqual({ state: 'latched', effects: ['startTimer', 'cancelTimer', 'show'] });
    expect(run([down, hotkey, timer]).state).toBe('latched');
  });

  it('holding the key does not disturb a latched list', () => {
    expect(run([hotkey, down, timer, up(false)]).state).toBe('latched');
  });
});

describe('the list belongs to the property being edited', () => {
  it('clicking into another property closes any open list', () => {
    for (const s of ['hold', 'sticky', 'latched'] as const) {
      expect(holdStep(s, click)).toEqual({ state: 'closed', effects: ['hide'] });
    }
    expect(holdStep('pending', click)).toEqual({ state: 'closed', effects: ['cancelTimer'] });
    expect(holdStep('closed', click)).toEqual({ state: 'closed', effects: [] });
  });

  it('a release with nothing pending does nothing', () => {
    expect(holdStep('closed', up())).toEqual({ state: 'closed', effects: [] });
  });
});

describe('noticing that the hold key is no longer down', () => {
  const none = { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false };

  it('reads the flag of the chosen key from any event', () => {
    expect(isModifierHeld('Alt', { ...none, altKey: true })).toBe(true);
    expect(isModifierHeld('Alt', none)).toBe(false);
    expect(isModifierHeld('Alt', { ...none, shiftKey: true })).toBe(false);
    expect(isModifierHeld('Shift', { ...none, shiftKey: true })).toBe(true);
    expect(isModifierHeld('Control', { ...none, ctrlKey: true })).toBe(true);
    expect(isModifierHeld('Meta', { ...none, metaKey: true })).toBe(true);
    expect(isModifierHeld('Meta', { ...none, altKey: true })).toBe(false);
  });

  it('a forced release (key gone, no pointer rule) closes both the waiting and the open list', () => {
    expect(holdStep('pending', { type: 'holdUp', pointerOverList: false, alwaysHide: true })).toEqual({ state: 'closed', effects: ['cancelTimer'] });
    expect(holdStep('hold', { type: 'holdUp', pointerOverList: false, alwaysHide: true })).toEqual({ state: 'closed', effects: ['hide'] });
  });
});
