/**
 * State machine for the option list in the Properties area (spec: "Properties area behaviour").
 *
 *   closed   no list
 *   pending  the hold key is down, waiting for the delay
 *   hold     list open because the key is held
 *   sticky   the key was released with the pointer over the list: stays until a click elsewhere or Escape
 *   latched  opened by the hotkey: stays until the hotkey or Escape
 *
 * It is pure: it returns the next state and what the caller must do, so every rule can be tested.
 */
export type HoldState = 'closed' | 'pending' | 'hold' | 'sticky' | 'latched';

export type HoldInput =
  | { type: 'holdDown'; repeat: boolean }
  | { type: 'holdUp'; pointerOverList: boolean; alwaysHide: boolean }
  /** Any other key pressed while the hold key is down (for example Option+G typing a symbol). */
  | { type: 'otherKey' }
  | { type: 'timer' }
  | { type: 'hotkey' }
  | { type: 'escape' }
  /** The user clicked outside the list or moved to another property. */
  | { type: 'clickElsewhere' };

export type HoldEffect = 'startTimer' | 'cancelTimer' | 'show' | 'hide' | 'consumeEscape';

export interface HoldResult {
  state: HoldState;
  effects: HoldEffect[];
}

const stay = (state: HoldState): HoldResult => ({ state, effects: [] });

export function holdStep(state: HoldState, input: HoldInput): HoldResult {
  switch (input.type) {
    case 'holdDown':
      if (input.repeat) return stay(state);
      return state === 'closed' ? { state: 'pending', effects: ['startTimer'] } : stay(state);

    case 'timer':
      return state === 'pending' ? { state: 'hold', effects: ['show'] } : stay(state);

    case 'otherKey':
      // Typing with Option held must not pop the list up; once it is open, keys are ignored.
      return state === 'pending' ? { state: 'closed', effects: ['cancelTimer'] } : stay(state);

    case 'holdUp':
      if (state === 'pending') return { state: 'closed', effects: ['cancelTimer'] };
      if (state === 'hold') {
        if (!input.alwaysHide && input.pointerOverList) return stay('sticky');
        return { state: 'closed', effects: ['hide'] };
      }
      return stay(state);

    case 'hotkey':
      if (state === 'closed') return { state: 'latched', effects: ['show'] };
      if (state === 'pending') return { state: 'latched', effects: ['cancelTimer', 'show'] };
      if (state === 'hold' || state === 'sticky') return stay('latched'); // already open: just latch it
      return { state: 'closed', effects: ['hide'] }; // latched: the same hotkey closes

    case 'escape':
      if (state === 'closed') return stay('closed'); // not ours: the field handles Escape as usual
      if (state === 'pending') return { state: 'closed', effects: ['cancelTimer'] };
      return { state: 'closed', effects: ['hide', 'consumeEscape'] };

    case 'clickElsewhere':
      if (state === 'closed') return stay('closed');
      if (state === 'pending') return { state: 'closed', effects: ['cancelTimer'] };
      return { state: 'closed', effects: ['hide'] };
  }
}

export interface ModifierFlags {
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** Is the chosen hold key still down, according to the modifier flags carried by any keyboard or mouse event? */
export function isModifierHeld(holdKey: 'Alt' | 'Shift' | 'Control' | 'Meta', e: ModifierFlags): boolean {
  switch (holdKey) {
    case 'Alt':
      return e.altKey;
    case 'Shift':
      return e.shiftKey;
    case 'Control':
      return e.ctrlKey;
    case 'Meta':
      return e.metaKey;
  }
}
