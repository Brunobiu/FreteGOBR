import { useState } from 'react';

export type ViewMode = 'cards' | 'table';

export function useViewPreference(key: string, defaultMode: ViewMode = 'cards'): [ViewMode, (mode: ViewMode) => void] {
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem(key);
      return (saved as ViewMode) || defaultMode;
    } catch {
      return defaultMode;
    }
  });

  const updateViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(key, mode);
    } catch {
      /* ignore */
    }
  };

  return [viewMode, updateViewMode];
}
