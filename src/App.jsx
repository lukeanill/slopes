import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipPanel } from '@lukeanill/ui/components/animate-ui/components/base/tooltip';
import { Popover, PopoverTrigger, PopoverPanel } from '@lukeanill/ui/components/animate-ui/components/base/popover';
import { ShimmeringText } from '@lukeanill/ui/components/animate-ui/primitives/texts/shimmering';
import AddressSearchBar from './AddressSearchBar.jsx';
import SlopeDistributionChart from './SlopeDistributionChart.jsx';
import { initSlopeMap } from './slopeMap.js';

// Griffith Park / Hollywood Hills — biases address autosuggest toward this app's actual
// coverage area (LA parcels/zoning only resolve here anyway), independent of the map's
// default landing zoom/center in slopeMap.js.
const SEARCH_PROXIMITY = [-118.335827, 34.106652];

// Street-type suffixes that mark where the street name ends and the city name begins in the
// county's "<street> <city> <state> <zip>" format (city can be multiple words, e.g. "Los
// Angeles") — used to insert commas around the city, since nothing else in the raw string marks
// that boundary.
const STREET_TYPES = new Set([
  'ST', 'AVE', 'BLVD', 'DR', 'RD', 'LN', 'WAY', 'CT', 'PL', 'TER', 'CIR', 'PKWY', 'HWY', 'TRL', 'LOOP', 'WALK',
]);

// The county's SitusFullAddress comes back SHOUTING IN ALL CAPS with no punctuation — title-case
// it for display (keeping single-letter directionals like N/S/E/W and the state code uppercase),
// and add the commas a real address needs before/after the city.
function titleCaseAddress(address) {
  const words = address.split(' ');
  const cased = words.map((word, i) => {
    if (/^\d+$/.test(word)) return word;
    if (/^[A-Z]$/.test(word)) return word;
    if (i === words.length - 2 && /^[A-Z]{2}$/.test(word)) return word;
    return word.charAt(0) + word.slice(1).toLowerCase();
  });

  let streetEndIndex = -1;
  for (let i = 0; i < words.length; i++) {
    if (STREET_TYPES.has(words[i].toUpperCase())) streetEndIndex = i;
  }
  const stateIndex = words.length - 2;
  if (streetEndIndex !== -1 && streetEndIndex < stateIndex - 1) {
    cased[streetEndIndex] += ',';
    cased[stateIndex - 1] += ',';
  }
  return cased.join(' ');
}

function MapApp() {
  const mapRef = useRef(null);
  const [slopeHover, setSlopeHover] = useState(null);
  const [selectedParcel, setSelectedParcel] = useState(null);
  const [bandHover, setBandHover] = useState(null);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    mapRef.current = initSlopeMap({
      onSlopeHover: setSlopeHover,
      onParcelSelect: setSelectedParcel,
      onStatusChange: setStatus,
    });
    return () => mapRef.current?.remove();
  }, []);

  return (
    <div id="app">
      <div id="map"></div>
      <Tooltip open={!!slopeHover}>
        <TooltipTrigger render={<span style={{ display: 'none' }} />} />
        <TooltipPanel
          className="slope-tooltip-panel"
          side="top"
          sideOffset={14}
          anchor={{
            getBoundingClientRect: () => {
              const x = slopeHover?.x ?? 0;
              const y = slopeHover?.y ?? 0;
              return { x, y, width: 0, height: 0, top: y, left: x, right: x, bottom: y };
            },
          }}
          style={slopeHover ? { backgroundColor: slopeHover.color, color: slopeHover.textColor } : undefined}
        >
          {slopeHover && `${Math.round(slopeHover.percent)}% (${slopeHover.degrees.toFixed(1)}°)`}
        </TooltipPanel>
      </Tooltip>
      <Popover open={!!selectedParcel} onOpenChange={(open) => { if (!open) mapRef.current?.clearSelection(); }}>
        <PopoverTrigger render={<button type="button" style={{ display: 'none' }} />} />
        <PopoverPanel
          className="parcel-popover"
          side="right"
          sideOffset={14}
          collisionPadding={24}
          collisionAvoidance={{ side: 'flip', align: 'shift' }}
          anchor={{
            getBoundingClientRect: () => {
              const r = selectedParcel?.anchorRect;
              if (!r) return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
              return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, top: r.top, left: r.left, right: r.right, bottom: r.bottom };
            },
          }}
        >
          {selectedParcel?.stats?.sampleCount === 0 ? (
            <p>No slope data available yet for this parcel — zoom in or pan closer and try again.</p>
          ) : selectedParcel?.stats ? (
            <>
              <div className="parcel-chart-wrap">
                <SlopeDistributionChart samples={selectedParcel.stats.samples} onHover={setBandHover} />
                <Tooltip open={!!bandHover}>
                  <TooltipTrigger render={<button type="button" style={{ display: 'none' }} />} />
                  <TooltipPanel
                    side="top"
                    sideOffset={14}
                    anchor={{
                      getBoundingClientRect: () => {
                        const x = bandHover?.x ?? 0;
                        const y = bandHover?.y ?? 0;
                        return { x, y, width: 0, height: 0, top: y, left: x, right: x, bottom: y };
                      },
                    }}
                  >
                    {bandHover && `${bandHover.pct}% slope`}
                  </TooltipPanel>
                </Tooltip>
              </div>
              <span className="parcel-summary-badge" style={{ backgroundColor: selectedParcel.stats.summaryColor }}>
                {selectedParcel.stats.summaryLabel}
              </span>
              <h2 className="parcel-address">{selectedParcel.address ? titleCaseAddress(selectedParcel.address) : `Parcel ${selectedParcel.ain ?? ''}`}</h2>
              <div className="parcel-stats-row">
                <div className="parcel-stat">
                  <span className="parcel-stat-value">{Math.round(selectedParcel.stats.minPercent)}-{Math.round(selectedParcel.stats.maxPercent)}%</span>
                  <span className="parcel-label">Slope range</span>
                </div>
                <div className="parcel-stat">
                  <span className="parcel-stat-value">{Math.round(selectedParcel.stats.modePercent)}%</span>
                  <span className="parcel-label">Most prevalent</span>
                </div>
              </div>
              <div className="parcel-info-row">
                <span className="parcel-label">APN</span>
                <span>{selectedParcel.ain ?? '—'}</span>
              </div>
              <div className="parcel-info-row">
                <span className="parcel-label">Zoning</span>
                {selectedParcel.zoningLoading ? (
                  <span className="skeleton skeleton-text" />
                ) : selectedParcel.zoning ? (
                  <a className="parcel-zone-link" href="https://zimas.lacity.org/" target="_blank" rel="noopener noreferrer">
                    {selectedParcel.zoning.TOOLTIP || selectedParcel.zoning.ZONING_DESCRIPTION}
                    <ExternalLink size={12} strokeWidth={2.25} />
                  </a>
                ) : (
                  <span>Unavailable</span>
                )}
              </div>
            </>
          ) : null}
        </PopoverPanel>
      </Popover>
      <div id="bottom-fade"></div>
      <AddressSearchBar
        proximity={SEARCH_PROXIMITY}
        onSelectAddress={({ lng, lat }) => mapRef.current?.goToAddress(lng, lat)}
      />
      <div className={`zoom-status-pill${status ? ' is-visible' : ''}`}>
        {status ? (
          <ShimmeringText
            key={status.kind === 'loading' ? status.label : status.text}
            text={status.kind === 'loading' ? status.label : status.text}
            duration={2.3}
            wave
            color="#ffffff"
            shimmeringColor="rgba(255, 255, 255, 0.4)"
          />
        ) : null}
      </div>
      <div id="map-controls">
        <div id="zoom-level" aria-label="Current zoom level"></div>
        <button id="reset-bearing" className="map-control-btn" type="button" aria-label="Reset to north"></button>
        <div className="map-control-zoom-pill">
          <button id="zoom-in" className="map-control-btn map-control-btn-top" type="button" aria-label="Zoom in"></button>
          <button id="zoom-out" className="map-control-btn map-control-btn-bottom" type="button" aria-label="Zoom out"></button>
        </div>
      </div>
      <div id="bottom-bar">
        <div id="gradient-wrap">
          <div id="gradient-bar"></div>
          <div id="gradient-tooltip"></div>
        </div>
        <div id="controls">
          <button id="reset-view" className="icon-btn" type="button" aria-label="Reset view"></button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return <MapApp />;
}
