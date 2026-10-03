import { useEffect, useState } from 'react';
import { api, type SiteConfig } from './api';

export function useConfig() {
  const [c, setC] = useState<SiteConfig | null>(null);
  useEffect(() => { api.config().then(setC); }, []);
  return c;
}

/** The switch between the two views of the corpus, shared with the hex map (same markup and class names). */
export function Suite({ here, aid }: { here: 'map' | 'diagrams'; aid?: string }) {
  const c = useConfig();
  if (!c?.map) return null;
  return <nav className="suite" aria-label="Views">
    <a href={c.map + (aid ? `#${aid}` : '')} aria-current={here === 'map' ? 'page' : undefined}><i className="suite-hx" />Map</a>
    <a href="#/" aria-current={here === 'diagrams' ? 'page' : undefined}><i className="suite-dg" />Diagrams</a>
  </nav>;
}
