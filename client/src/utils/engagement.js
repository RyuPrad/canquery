// Automated browsers that open pages with nobody behind them (crawlers and
// AI-agent browsers, some with ordinary Chrome user agents) started a table
// preparation for nearly every file they opened. Preparation now waits for
// the first sign of a person: a pointer that moves or presses, a touch, a
// wheel, a key or a click. Events created by scripts do not count, and a
// pointer only moves when its position changes between two reports, so
// content moving under a resting cursor is not movement (WebKit leaves
// movementX at zero, so it cannot tell). Scrolling and focus are left out:
// code can do both.
const PERSON_EVENTS = ['pointermove', 'pointerdown', 'touchstart', 'wheel', 'keydown', 'click'];
const OPTIONS = { capture: true, passive: true };

let engaged = false;
/** @type {EventTarget | null} */
let watched = null;
/** @type {{ x: number, y: number } | null} */
let pointer = null;
/** @type {Set<() => void>} */
const subscribers = new Set();

/** @param {Event & { clientX?: number, clientY?: number }} event */
export function isPersonInput(event) {
  if (!event.isTrusted || !PERSON_EVENTS.includes(event.type)) return false;
  if (event.type !== 'pointermove') return true;
  const previous = pointer;
  pointer = { x: event.clientX ?? 0, y: event.clientY ?? 0 };
  return previous !== null && (previous.x !== pointer.x || previous.y !== pointer.y);
}

/** @param {Event} event */
function onInput(event) {
  if (isPersonInput(event)) markEngaged();
}

// Called once at start-up, so the click that opened a resource page inside
// the app already counts.
/** @param {EventTarget} [target] */
export function watchEngagement(target = window) {
  if (engaged || watched) return;
  watched = target;
  for (const type of PERSON_EVENTS) target.addEventListener(type, onInput, OPTIONS);
}

export function markEngaged() {
  if (engaged) return;
  engaged = true;
  if (watched) {
    for (const type of PERSON_EVENTS) watched.removeEventListener(type, onInput, OPTIONS);
    watched = null;
  }
  for (const notify of subscribers) notify();
}

export const isEngaged = () => engaged;

/** @param {() => void} notify */
export function subscribeEngagement(notify) {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}
