import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

// Reconstructed component — see chat for context. Uses Mapbox's Geocoding API directly (no
// separate geocoder package was present to restore), biased toward `proximity` so results
// favor this app's actual coverage area.
export default function AddressSearchBar({ proximity, onSelectAddress }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [selected, setSelected] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (selected || query.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const token = import.meta.env.VITE_MAPBOX_TOKEN;
        const params = new URLSearchParams({
          access_token: token,
          autocomplete: 'true',
          limit: '5',
          proximity: proximity ? `${proximity[0]},${proximity[1]}` : 'ip',
        });
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params}`
        );
        const json = await res.json();
        setSuggestions(json.features ?? []);
      } catch (err) {
        console.error('Geocode failed', err);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [query, proximity, selected]);

  function pick(feature) {
    setSelected(feature);
    setQuery(feature.place_name);
    setSuggestions([]);
    const [lng, lat] = feature.center;
    onSelectAddress?.({ lng, lat });
  }

  function reset() {
    setSelected(null);
    setQuery('');
    setSuggestions([]);
  }

  return (
    <div className="address-search">
      <div className="address-search-shell">
        <div className="address-search-pill">
          <div className="address-search-pill-inner">
            <Search size={16} strokeWidth={2} />
            <input
              type="text"
              placeholder="Search an address"
              value={query}
              onChange={(e) => { setSelected(null); setQuery(e.target.value); }}
            />
          </div>
        </div>
        {selected && (
          <button type="button" className="address-search-close" onClick={reset} aria-label="Clear search">
            <X size={16} strokeWidth={2} />
          </button>
        )}
        {suggestions.length > 0 && (
          <ul className="address-search-suggestions">
            {suggestions.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => pick(f)}>{f.place_name}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
