import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Search, X } from 'lucide-react';
import ParcelHistory from './ParcelHistory.jsx';

// Search-only adaptation of the design system's MorphingDiscoveryBar
// (@lukeanill/ui/components/animate-ui/components/base/morphing-discovery-bar): the same
// circle-to-pill morph, spring and close button, minus the category tabs — and wired to
// Mapbox's Geocoding API, which the stock component (no value/onChange/results) can't be.
// Results are biased toward `proximity` so they favor this app's actual coverage area.
// Opening search with nothing typed shows recently viewed parcels; typing swaps them for results.
const transition = { damping: 32, mass: 1, stiffness: 520, type: 'spring' };
// Pill and close button use the About button's glass style so the top-row controls match.

// The dropdown panel (recent parcels or results) eases rather than springs, so swapping between
// them reads as one surface changing content, not two things bouncing past each other.
const EASE_OUT = [0.22, 1, 0.36, 1];
const panelMotion = {
  initial: { opacity: 0, y: -6, scale: 0.98, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: { duration: 0.24, ease: EASE_OUT } },
  exit: { opacity: 0, y: -6, scale: 0.98, filter: 'blur(4px)', transition: { duration: 0.16, ease: 'easeIn' } },
};

// Choosing a result is choreographed instead of everything changing at once: the panel leaves
// first, then the pill collapses back to its circle, and only once that has settled does the
// map start flying — so the bar's animation never competes with the map's for frames.
const PANEL_EXIT_MS = 140;
const COLLAPSE_SETTLE_MS = 220;

export default function AddressSearchBar({ proximity, onSelectAddress, history = [], onSelectHistory, onOpenChange }) {
  const [isSearching, setIsSearching] = useState(false);
  const [closing, setClosing] = useState(false);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const requestRef = useRef(0);
  const timersRef = useRef([]);

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  // Lets the page move its other controls aside while search is open. Reports "closed" as soon as
  // closing starts, so they come back in step with the panel leaving rather than after it.
  useEffect(() => {
    onOpenChange?.(isSearching && !closing);
  }, [isSearching, closing, onOpenChange]);

  useEffect(() => {
    if (!isSearching) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [isSearching]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (query.trim().length < 3) {
      requestRef.current++; // drop any in-flight response for an older query
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestRef.current;
      try {
        const params = new URLSearchParams({
          access_token: import.meta.env.VITE_MAPBOX_TOKEN,
          autocomplete: 'true',
          limit: '5',
          proximity: proximity ? `${proximity[0]},${proximity[1]}` : 'ip',
        });
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params}`
        );
        const json = await res.json();
        if (requestId === requestRef.current) setSuggestions(json.features ?? []);
      } catch (err) {
        console.error('Geocode failed', err);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [query, proximity]);

  function reset() {
    setIsSearching(false);
    setClosing(false);
    setQuery('');
    setSuggestions([]);
  }

  function later(fn, ms) {
    timersRef.current.push(setTimeout(fn, ms));
  }

  // Panel out → pill collapses → then `then` runs (the map flight).
  function closeThen(then) {
    if (closing) return;
    inputRef.current?.blur(); // drop the phone keyboard straight away
    setClosing(true);
    later(reset, PANEL_EXIT_MS);
    if (then) later(then, PANEL_EXIT_MS + COLLAPSE_SETTLE_MS);
  }

  function pick(feature) {
    const [lng, lat] = feature.center;
    closeThen(() => onSelectAddress?.({ lng, lat }));
  }

  function pickHistory(item) {
    closeThen(() => onSelectHistory?.(item));
  }

  const panel = !isSearching || closing
    ? null
    : query === '' && history.length > 0
      ? 'history'
      : suggestions.length > 0
        ? 'results'
        : null;

  return (
    <motion.div layout transition={transition} className="relative flex items-center gap-1.5">
      <motion.div
        layout
        transition={transition}
        className={`relative flex h-11 items-center overflow-hidden rounded-full border border-white/25 bg-[rgba(16,15,15,0.45)] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_4px_16px_rgba(0,0,0,0.25)] backdrop-blur-md ${
          isSearching ? 'w-[calc(100vw-96px)] sm:w-80' : 'w-11'
        }`}
      >
        <div className="flex h-full w-full items-center justify-center px-3">
          <motion.div layout="position" transition={transition}>
            <Search size={16} strokeWidth={2.25} className="shrink-0 text-white" />
          </motion.div>
          <AnimatePresence mode="wait">
            {isSearching && (
              <motion.input
                key="search-input"
                ref={inputRef}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: closing ? 0 : 1, x: 0 }}
                exit={{ opacity: 0, x: -5 }}
                transition={{ duration: 0.15 }}
                placeholder="Search an address"
                aria-label="Search an address"
                className="ml-2 w-full border-none bg-transparent text-sm font-medium text-white outline-none placeholder:text-white/60"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') closeThen();
                  if (e.key === 'Enter' && suggestions[0]) pick(suggestions[0]);
                }}
              />
            )}
          </AnimatePresence>
          {!isSearching && (
            <button
              type="button"
              aria-label="Search an address"
              className="absolute inset-0 z-10 h-full w-full cursor-pointer"
              onClick={() => setIsSearching(true)}
            />
          )}
        </div>
      </motion.div>

      <AnimatePresence mode="popLayout">
        {isSearching && (
          <motion.button
            key="close-action"
            type="button"
            aria-label="Close search"
            layout
            initial={{ opacity: 0, rotate: -90, scale: 0.8 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: -90, scale: 0.8 }}
            transition={transition}
            whileTap={{ scale: 0.9 }}
            onClick={() => closeThen()}
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/25 bg-[rgba(16,15,15,0.45)] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_4px_16px_rgba(0,0,0,0.25)] backdrop-blur-md text-white transition-colors hover:bg-[rgba(16,15,15,0.6)]"
          >
            <X size={16} strokeWidth={2.25} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* One panel under the pill whose content crossfades between recent parcels and results. */}
      <div className="pointer-events-none absolute top-full right-[50px] left-0 mt-2">
        <AnimatePresence mode="popLayout" initial={false}>
          {panel === 'history' && (
            <motion.div key="history" {...panelMotion} style={{ transformOrigin: 'top center' }} className="pointer-events-auto">
              <ParcelHistory items={history} onSelect={pickHistory} />
            </motion.div>
          )}
          {panel === 'results' && (
            <motion.ul
              key="results"
              {...panelMotion}
              style={{ transformOrigin: 'top center' }}
              className="pointer-events-auto space-y-0.5 rounded-2xl border border-border bg-card p-1.5 shadow-md"
            >
              {suggestions.map((f, i) => (
                <motion.li
                  key={f.id}
                  initial={{ opacity: 0, y: -2 }}
                  animate={{ opacity: 1, y: 0, transition: { duration: 0.2, delay: i * 0.025, ease: EASE_OUT } }}
                >
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.98 }}
                    onClick={() => pick(f)}
                    className="w-full cursor-pointer truncate rounded-xl px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    {f.place_name}
                  </motion.button>
                </motion.li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
