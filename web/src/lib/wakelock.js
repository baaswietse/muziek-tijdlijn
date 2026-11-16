// Houdt het scherm wakker zolang het spel open staat. Zo vergrendelt de gsm
// niet tijdens het spel (minder verbroken verbindingen, en bij de host geen
// vergrendelscherm dat de titel van het nummer toont).

let lock = null;
let wanted = false;

async function acquire() {
  if (!wanted || lock || document.visibilityState !== 'visible') return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => {
      lock = null;
    });
  } catch {
    // Niet ondersteund of geweigerd (bv. batterijbesparing): geen ramp.
  }
}

export function keepAwake(on) {
  if (!('wakeLock' in navigator)) return;
  wanted = on;
  if (on) acquire();
  else if (lock) lock.release().catch(() => {});
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', acquire);
}
