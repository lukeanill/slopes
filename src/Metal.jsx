import { useContext } from 'react';
import { MetalFx } from 'metal-fx';
import { ThemeContext } from './theme.js';

// The app's control style, after the metal-fx v1 demo on libraries.dev:
//  - quiet: a solid control (#1d1d1d with light text on dark, white with dark text on light) and a
//    hairline rim. Plain controls just use the QUIET class.
//  - metal: a live liquid-metal ring (chromatic, strength 0.9) for a control while it's active —
//    a message being shown, playback, an open menu or search.
// Controls that switch between the two wrap their host in <Metal active={…}>. The metal-fx instance
// stays mounted and only its strength changes, so switching never remounts the host (an open input
// keeps focus) and quiet Metal matches QUIET (see .metal-fx-root[data-quiet] in style.css). The
// host stays transparent (METAL_HOST) — the surface is the wrapper's. `circle` for round controls,
// `button` for pills; `halo` adds v1's wandering halo. Without WebGL2 the host renders plainly.
export const METAL_HOST =
  'flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-transparent text-inherit';
export const QUIET = 'quiet-control flex shrink-0 cursor-pointer items-center justify-center rounded-full';

export default function Metal({ children, variant = 'circle', active = true, halo = false, className, reflectionTargets }) {
  const { map: theme } = useContext(ThemeContext);
  return (
    <MetalFx
      variant={variant}
      preset="chromatic"
      strength={active ? 0.9 : 0}
      theme={theme}
      disableGlow={!active || !halo}
      reflectionTargets={active ? reflectionTargets : undefined}
      className={className}
      data-quiet={active ? undefined : 'true'}
    >
      {children}
    </MetalFx>
  );
}
