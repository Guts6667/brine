'use client';
import {useEffect, useState} from 'react';

/** Keep the place in a prospect's work without saving a different prospect's choice. */
export function useSessionChoice<T extends string>(key: string, choices: readonly T[], initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState('');
  const allowed = choices.join('|');
  useEffect(() => {
    let next = initial;
    try {
      const saved = sessionStorage.getItem(key);
      if (saved && allowed.split('|').includes(saved)) next = saved as T;
    } catch {}
    setValue(next);
    setLoaded(key + allowed);
  }, [key, allowed, initial]);
  useEffect(() => {
    if (loaded !== key + allowed) return;
    try { sessionStorage.setItem(key, value); } catch {}
  }, [key, allowed, loaded, value]);
  return [value, setValue] as const;
}
