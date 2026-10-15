import { useState } from 'react';

// URL updates render in a transition, so a controlled checkbox would wait for
// the next results render before ticking. The controls show the requested
// state at once, and quick successive changes build on it, until the URL
// catches up (or another navigation replaces it).
export default function useOptimisticSearch(search, apply) {
  const basis = JSON.stringify(search);
  const [pending, setPending] = useState(null);
  const shown = pending && pending.basis === basis ? pending.next : search;
  const change = (next) => {
    setPending({ basis, next });
    apply(next);
  };
  return [shown, change];
}
