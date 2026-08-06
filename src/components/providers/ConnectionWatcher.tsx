'use client';

import { useEffect } from 'react';
import { toast } from '@/store/toastStore';

/**
 * Says the quiet part out loud: you are offline.
 *
 * This app is local-first — every edit lands in IndexedDB first and the cloud
 * converges afterwards (see syncService). That architecture is the reason it
 * keeps working on a train, and it is ALSO the reason the failure mode is so
 * disorienting: with the network gone, the board behaves perfectly. Blocks
 * move, text saves, the save indicator ticks over. Nothing suggests that the
 * copy on the server stopped keeping up, so you close the laptop believing a
 * device-local copy is a backed-up one.
 *
 * The notice is STICKY (`duration: 0`) rather than timed, because this is a
 * condition, not an event — it is true until it stops being true, and a message
 * that expires after four seconds would imply it had been resolved. It is also
 * carefully worded to reassure rather than alarm: nothing is lost, it just
 * hasn't left this device yet, and that is exactly what the user needs to know
 * in order to decide whether it's safe to walk away.
 */

const OFFLINE_KEY = 'net-offline';

export default function ConnectionWatcher() {
  useEffect(() => {
    // `navigator.onLine` is famously optimistic — it reports the state of the
    // network INTERFACE, not whether anything is reachable through it. That is
    // fine for what this does: a false negative is impossible (offline really
    // does mean no requests will leave), and the case it misses — connected to
    // a captive portal that drops everything — is covered by the separate
    // sync-failure notice raised from syncService.
    const goOffline = () => {
      toast.show({
        kind: 'info',
        key: OFFLINE_KEY,
        duration: 0,
        message: "You're offline",
        detail: 'Edits are saving to this device and will sync when you reconnect.',
      });
    };

    const goOnline = () => {
      toast.resolve(OFFLINE_KEY);
      toast.success('Back online', { detail: 'Catching the cloud up now.' });
    };

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);

    // Cover the cold start: a reload while already offline fires no event at
    // all, so without this check the app would come up silent and disconnected.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) goOffline();

    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  return null;
}
