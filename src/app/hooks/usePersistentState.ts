import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { readLocal } from "../types";

/**
 * useState backed by localStorage: seeds from the stored value on mount and
 * writes back on every change.
 *
 * The read half matters — these keys were previously written but never read,
 * so a reload always started from the fallback and then overwrote the store.
 */
export function usePersistentState<T>(
  key: string,
  fallback: T,
  valid: (v: unknown) => boolean,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readLocal(key, fallback, valid));

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Quota exceeded or Safari private mode. Losing the cache is survivable;
      // throwing out of an effect would take the render down with it.
    }
  }, [key, value]);

  return [value, setValue];
}
