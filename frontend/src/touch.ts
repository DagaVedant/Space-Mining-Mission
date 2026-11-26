export interface TouchState {
  moveX: number;
  moveY: number;
  aim: number | null;
  firing: boolean;
  boosting: boolean;
  interacting: boolean;
  pulsing: boolean;
}

export interface TouchControls {
  state: TouchState;
  destroy(): void;
}

export function mountTouchControls(): TouchControls {
  const root = document.getElementById('ui');
  if (!root) throw new Error('Touch controls require the game UI root.');
  root.querySelector('#touch-controls')?.remove();
  const panel = document.createElement('div');
  panel.id = 'touch-controls';
  panel.innerHTML = `
    <div class="touch-stick" data-pad="move" role="application" aria-label="Move joystick">
      <span class="stick-knob"></span><b>MOVE</b>
    </div>
    <div class="touch-actions">
      <button type="button" data-touch="pulse" aria-label="Fire pulse">PULSE</button>
      <button type="button" data-touch="boost" aria-label="Hold to boost">BOOST</button>
      <button type="button" data-touch="interact" aria-label="Dock or interact">DOCK</button>
    </div>
    <div class="touch-stick aim-stick" data-pad="aim" role="application" aria-label="Aim joystick; hold to fire">
      <span class="stick-knob"></span><b>AIM / FIRE</b>
    </div>`;
  root.appendChild(panel);
  const state: TouchState = { moveX: 0, moveY: 0, aim: null, firing: false, boosting: false, interacting: false, pulsing: false };
  const active = new Map<number, { pad: HTMLElement; kind: 'move' | 'aim' }>();
  const listeners: Array<[HTMLElement, string, EventListener]> = [];
  const listen = (element: HTMLElement, type: string, handler: EventListener): void => {
    element.addEventListener(type, handler);
    listeners.push([element, type, handler]);
  };
  const updatePad = (pointer: PointerEvent, pad: HTMLElement, kind: 'move' | 'aim'): void => {
    const rect = pad.getBoundingClientRect();
    const dx = (pointer.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const dy = (pointer.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    const length = Math.hypot(dx, dy);
    const scale = length > 1 ? 1 / length : 1;
    const x = dx * scale;
    const y = dy * scale;
    const knob = pad.querySelector<HTMLElement>('.stick-knob');
    if (knob) {
      knob.style.left = `${50 + x * 32}%`;
      knob.style.top = `${50 + y * 32}%`;
    }
    if (kind === 'move') {
      state.moveX = x;
      state.moveY = y;
    } else if (length > 0.12) {
      state.aim = Math.atan2(y, x);
      state.firing = true;
    } else {
      state.firing = false;
    }
  };
  for (const pad of Array.from(panel.querySelectorAll<HTMLElement>('[data-pad]'))) {
    const kind = pad.dataset.pad as 'move' | 'aim';
    listen(pad, 'pointerdown', ((event: PointerEvent) => {
      event.preventDefault();
      active.set(event.pointerId, { pad, kind });
      pad.setPointerCapture(event.pointerId);
      updatePad(event, pad, kind);
    }) as EventListener);
    listen(pad, 'pointermove', ((event: PointerEvent) => {
      if (active.has(event.pointerId)) updatePad(event, pad, kind);
    }) as EventListener);
    const end = ((event: PointerEvent) => {
      active.delete(event.pointerId);
      const knob = pad.querySelector<HTMLElement>('.stick-knob');
      if (knob) {
        knob.style.left = '50%';
        knob.style.top = '50%';
      }
      if (kind === 'move') {
        state.moveX = 0;
        state.moveY = 0;
      } else state.firing = false;
    }) as EventListener;
    listen(pad, 'pointerup', end);
    listen(pad, 'pointercancel', end);
  }
  for (const button of Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-touch]'))) {
    const action = button.dataset.touch;
    const set = (value: boolean): void => {
      if (action === 'boost') state.boosting = value;
      if (action === 'interact') state.interacting = value;
      if (action === 'pulse') state.pulsing = value;
    };
    listen(button, 'pointerdown', ((event: PointerEvent) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      set(true);
    }) as EventListener);
    listen(button, 'pointerup', (() => set(false)) as EventListener);
    listen(button, 'pointercancel', (() => set(false)) as EventListener);
    listen(button, 'lostpointercapture', (() => set(false)) as EventListener);
  }
  return {
    state,
    destroy(): void {
      for (const [element, type, handler] of listeners) element.removeEventListener(type, handler);
      panel.remove();
    },
  };
}
