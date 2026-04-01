'use client';
import { useState, useEffect, useRef } from 'react';

// Module-level cache — persists for the entire browser session across
// page navigations. Key = URL string, value = { data, timestamp }.
const browserCache = new Map();
const BROWSER_TTL = 5 * 60 * 1000; // 5 minutes

function isFresh(entry) {
  return entry && Date.now() - entry.timestamp < BROWSER_TTL;
}

/**
 * useFetch(url)
 *
 * Drop-in data fetching hook with browser-side caching.
 *
 * - First load: fetches from the API, shows loading state, caches result.
 * - Re-visit same page: returns cached data INSTANTLY (no loading flash),
 *   then quietly re-fetches in the background to stay fresh.
 * - Different URL (e.g. changed filters): treats as a fresh fetch.
 * - Pass null as the url to skip fetching (useful for conditional fetches).
 */
export function useFetch(url) {
  const cached = url ? browserCache.get(url) : null;
  const hasFreshCache = isFresh(cached);

  const [data, setData] = useState(hasFreshCache ? cached.data : null);
  const [loading, setLoading] = useState(!hasFreshCache);
  const [error, setError] = useState(null);

  // Track the current url so stale responses don't overwrite newer ones
  const currentUrl = useRef(url);

  useEffect(() => {
    if (!url) return;
    currentUrl.current = url;

    const existing = browserCache.get(url);

    // If we have fresh cached data, show it immediately and revalidate quietly
    if (isFresh(existing)) {
      setData(existing.data);
      setLoading(false);
      setError(null);
      // Revalidate silently in background (no loading spinner)
      fetch(url)
        .then(r => r.json())
        .then(fresh => {
          if (currentUrl.current !== url) return;
          browserCache.set(url, { data: fresh, timestamp: Date.now() });
          setData(fresh);
        })
        .catch(() => {}); // silent — we already have data to show
      return;
    }

    // No fresh cache — full load
    setLoading(true);
    setError(null);
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(result => {
        if (currentUrl.current !== url) return;
        browserCache.set(url, { data: result, timestamp: Date.now() });
        setData(result);
        setLoading(false);
      })
      .catch(err => {
        if (currentUrl.current !== url) return;
        setError(err.message);
        setLoading(false);
      });
  }, [url]);

  return { data, loading, error };
}
