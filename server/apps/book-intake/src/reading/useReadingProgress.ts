import { useEffect, useRef, useState } from 'react';
import { AUTO_READ_MS, ReadingClock } from '../lib/reading';
import { setPagesRead } from '../lib/db';

export function useReadingProgress({ unitIds, visibleIds, enabled, paused, onMarked, onError }: {
    unitIds: string[]; visibleIds: string[]; enabled: boolean; paused: boolean;
    onMarked: (ids: string[]) => void; onError: (message: string) => void;
}) {
    const clock = useRef(new ReadingClock()), latest = useRef({ unitIds, visibleIds, enabled, paused, onMarked, onError });
    latest.current = { unitIds, visibleIds, enabled, paused, onMarked, onError };
    const [elapsed, setElapsed] = useState(0), [running, setRunning] = useState(false);
    const busy = useRef(false);
    useEffect(() => {
        let previous = performance.now(), live = true;
        const tick = () => {
            const current = latest.current, now = performance.now(), delta = now - previous; previous = now;
            const active = current.enabled && !current.paused && document.visibilityState === 'visible' && document.hasFocus();
            const result = clock.current.sample(current.unitIds.join('|'), current.unitIds, current.visibleIds, delta, active);
            setElapsed(result.elapsed); setRunning(active && !!current.visibleIds.length);
            if (result.ready.length && !busy.current) {
                busy.current = true;
                void setPagesRead(result.ready, true).then(() => { clock.current.acknowledge(result.ready); if (live) current.onMarked(result.ready); })
                    .catch(e => { if (live) current.onError(String(e)); })
                    .finally(() => { busy.current = false; });
            }
        };
        const reset = () => { previous = performance.now(); tick(); };
        const timer = setInterval(tick, 500);
        document.addEventListener('visibilitychange', reset); window.addEventListener('blur', reset); window.addEventListener('focus', reset);
        return () => { live = false; clearInterval(timer); document.removeEventListener('visibilitychange', reset); window.removeEventListener('blur', reset); window.removeEventListener('focus', reset); };
    }, []);
    return { elapsed, running, total: AUTO_READ_MS, suppress: (ids: string[]) => clock.current.suppress(ids) };
}
