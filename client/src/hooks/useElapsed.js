import { useState, useRef, useEffect } from 'react';

// Live-ticking elapsed seconds for an in-flight job. Anchored to the SERVER's
// age (Postgres now() - created_at), so it's immune to clock skew between the DB,
// the API and the browser; between polls it advances with the client clock and
// re-anchors whenever a fresh server age arrives. Because the age comes from the
// persisted job, the count stays correct across a page reload.
//
// All ref/Date.now() use lives in effects (never during render) so the value is
// pure state the component can render directly.
export default function useElapsed(ageSeconds, active = true) {
  const [elapsed, setElapsed] = useState(ageSeconds ?? 0);
  const anchorRef = useRef(null);

  useEffect(() => {
    if (ageSeconds == null) return;
    anchorRef.current = { age: ageSeconds, at: Date.now() };
    setElapsed(ageSeconds);
  }, [ageSeconds]);

  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => {
      const a = anchorRef.current;
      if (a) setElapsed(Math.max(0, Math.round(a.age + (Date.now() - a.at) / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [active]);

  return elapsed;
}
