import { StrictMode, createRef, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, Compass, Layers, Minus, Play, Plus, Search, Square, Video } from 'lucide-react';
import '@lukeanill/ui/globals.css';
import './style.css';
import Metal, { METAL_HOST, QUIET } from './Metal.jsx';
import { ThemeContext } from './theme.js';

// Dev-only page for inspecting components in isolation: /components.html on the dev server.
// The app's controls in the metal-fx v1 demo's style, laid out in their real groups. Each control
// can be switched to metal (the ring) and, when metal, have its wandering halo switched on.
// Metal controls reflect onto the quiet controls beside them (dark theme only).

const SANS = { fontFamily: "'Inter', system-ui, sans-serif" };
const ICON = { size: 18, strokeWidth: 1.75 };
const PILL = 'h-10 gap-2 px-4 text-sm font-medium';

// render({ className, ref }) builds the control's host element.
const GROUPS = [
  {
    title: 'Top bar',
    controls: [
      {
        id: 'search', label: 'Search', variant: 'button',
        render: (p) => (
          <button type="button" {...p} className={`${p.className} h-10 w-60 justify-start gap-2 pr-2 pl-3 text-sm font-medium`}>
            <Search {...ICON} /> <span className="opacity-45">Search address</span>
          </button>
        ),
      },
      { id: 'about', label: 'About', variant: 'button', render: (p) => <button type="button" {...p} className={`${p.className} ${PILL}`}>About</button> },
    ],
  },
  {
    title: 'Flyby',
    controls: [
      { id: 'play', label: 'Play', variant: 'circle', metal: true, render: (p) => <button type="button" aria-label="Play flyby" {...p} className={`${p.className} size-10`}><Play {...ICON} /></button> },
      {
        id: 'numbers', label: 'Scene numbers', variant: 'button',
        render: (p) => <button type="button" {...p} className={`${p.className} h-10 gap-5 px-5 text-sm font-medium tabular-nums`}><span>1</span><span>2</span><span>3</span></button>,
      },
      { id: 'add', label: 'Add scene', variant: 'circle', render: (p) => <button type="button" aria-label="Add scene" {...p} className={`${p.className} size-10`}><Plus {...ICON} /></button> },
    ],
  },
  {
    title: 'Flyby — other states',
    controls: [
      { id: 'scene', label: 'First scene', variant: 'button', render: (p) => <button type="button" {...p} className={`${p.className} ${PILL}`}><Video {...ICON} />Scene</button> },
      { id: 'play-label', label: 'Play (one scene)', variant: 'button', render: (p) => <button type="button" {...p} className={`${p.className} ${PILL}`}><Play {...ICON} />Play</button> },
      { id: 'stop', label: 'Stop', variant: 'circle', render: (p) => <button type="button" aria-label="Stop flyby" {...p} className={`${p.className} size-10`}><Square {...ICON} /></button> },
      { id: 'done', label: 'Done reordering', variant: 'circle', render: (p) => <button type="button" aria-label="Done reordering" {...p} className={`${p.className} size-10`}><Check {...ICON} /></button> },
    ],
  },
  {
    title: 'Map controls',
    controls: [
      { id: 'theme', label: 'Theme', variant: 'circle', render: (p) => <button type="button" aria-label="Theme" {...p} className={`${p.className} size-10`}><Layers {...ICON} /></button> },
      { id: 'zoom-level', label: 'Zoom level', variant: 'circle', render: (p) => <div {...p} className={`${p.className} size-10 cursor-default text-[13px] font-medium tabular-nums`}>12.4</div> },
      { id: 'north', label: 'North', variant: 'circle', render: (p) => <button type="button" aria-label="Reset to north" {...p} className={`${p.className} size-10`}><Compass {...ICON} /></button> },
      {
        id: 'zoom', label: 'Zoom', variant: 'button',
        render: (p) => (
          <div {...p} className={`${p.className} w-10 flex-col`}>
            <button type="button" aria-label="Zoom in" className="flex size-10 items-center justify-center"><Plus {...ICON} /></button>
            <button type="button" aria-label="Zoom out" className="flex size-10 items-center justify-center"><Minus {...ICON} /></button>
          </div>
        ),
      },
    ],
  },
];
const ALL = GROUPS.flatMap((g) => g.controls);

function Toggle({ on, disabled, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[11px] transition-colors disabled:opacity-20 ${on ? 'bg-current/15' : 'opacity-50 hover:opacity-80'}`}
    >
      {children}
    </button>
  );
}

function Group({ group, metal, halos, onToggleMetal, onToggleHalo, dark }) {
  // Refs of this group's quiet controls, which catch the metal ones' reflections.
  const refs = useMemo(() => Object.fromEntries(group.controls.map((c) => [c.id, createRef()])), [group]);
  const quietRefs = group.controls.filter((c) => !metal.has(c.id)).map((c) => refs[c.id]);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{group.title}</h2>
      <div className={`flex flex-col gap-8 rounded-2xl px-6 pt-14 pb-5 ${dark ? 'bg-[#171717]' : 'bg-[#f4f4f4]'}`}>
        {/* The controls as a tight toolbar, as in the app (and the metal-fx demo). */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          {group.controls.map((c) =>
            metal.has(c.id) ? (
              <Metal key={c.id} variant={c.variant} halo={halos.has(c.id)} reflectionTargets={quietRefs}>
                {c.render({ className: METAL_HOST })}
              </Metal>
            ) : (
              <div key={c.id} className="flex">{c.render({ className: QUIET, ref: refs[c.id] })}</div>
            )
          )}
        </div>
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 border-t border-current/10 pt-4">
          {group.controls.map((c) => (
            <div key={c.id} className="flex items-center gap-1">
              <span className="mr-1 text-[11px] opacity-60">{c.label}</span>
              <Toggle on={metal.has(c.id)} onClick={() => onToggleMetal(c.id)}>Metal</Toggle>
              <Toggle on={metal.has(c.id) && halos.has(c.id)} disabled={!metal.has(c.id)} onClick={() => onToggleHalo(c.id)}>Halo</Toggle>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const toggled = (set, id) => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

function Page() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'dark');
  const [metal, setMetal] = useState(() => new Set(ALL.filter((c) => c.metal).map((c) => c.id)));
  const [halos, setHalos] = useState(() => new Set());
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const dark = theme === 'dark';

  return (
    <ThemeContext.Provider value={{ map: theme, slope: 'rainbow', opacity: 1 }}>
      <main className={`min-h-screen px-4 py-10 sm:px-10 ${dark ? 'bg-[#111] text-white' : 'bg-white text-[#1d1d1d]'}`} style={SANS}>
        <div className="mx-auto flex max-w-3xl flex-col gap-10">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-medium">Components</h1>
              <p className="text-xs opacity-60">Switch any control to metal, and turn on its wandering halo.</p>
            </div>
            <Toggle on={false} onClick={() => setTheme(dark ? 'light' : 'dark')}>{dark ? 'Light' : 'Dark'} theme</Toggle>
          </header>
          {GROUPS.map((g) => (
            <Group
              key={g.title}
              group={g}
              metal={metal}
              halos={halos}
              dark={dark}
              onToggleMetal={(id) => setMetal((s) => toggled(s, id))}
              onToggleHalo={(id) => setHalos((s) => toggled(s, id))}
            />
          ))}
        </div>
      </main>
    </ThemeContext.Provider>
  );
}

const STRICT = new URLSearchParams(location.search).has('strict');
createRoot(document.getElementById('root')).render(STRICT ? <StrictMode><Page /></StrictMode> : <Page />);
