import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import useDebouncedValue from './useDebouncedValue.js';

// The URL owns the applied search. A draft belongs to one navigation, so its
// pending debounce cannot overwrite a different search opened via Back,
// Forward or an in-app link.
export default function useSearchDraft(applied, commit, delayMs = 250) {
  const location = useLocation();
  const [draft, setDraft] = useState({ key: location.key, value: applied });
  const value = draft.key === location.key ? draft.value : applied;
  const debounced = useDebouncedValue(value, delayMs);
  useEffect(() => {
    if (draft.key !== location.key || debounced !== draft.value || debounced === applied) return;
    commit(debounced);
  }, [debounced, draft, location.key, applied, commit]);
  return [value, (next) => setDraft({ key: location.key, value: next })];
}
