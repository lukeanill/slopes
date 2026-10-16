import { AnimatePresence, Reorder, motion } from 'motion/react';
import { Check, Play, Plus, Square, Video } from 'lucide-react';
import { Menu, MenuTrigger, MenuPanel, MenuItem } from '@lukeanill/ui/components/animate-ui/components/base/menu';
import Metal, { METAL_HOST, QUIET } from './Metal.jsx';

// Flyby builder from the SLOPES Figma (node 7:844). States:
//   none added   → one "Scene" pill that captures the first scene
//   1..7 added   → [Play] [scene numbers] [+]   (Play is a labelled pill with a single scene)
//   8 added      → [Play] [scene numbers]       (no more scenes allowed)
//   playing      → [Stop] [numbers, scenes not yet reached dimmed] — both in metal
//   numbers menu → tapping the numbers opens Reorder / Start over
//   reordering   → numbers drag sideways; the Play slot becomes Done
// Controls are quiet (see Metal.jsx) except Stop and the numbers during playback.
export const MAX_SCENES = 8;

const SANS = { fontFamily: "'Inter', system-ui, sans-serif" };
const ICON = { size: 18, strokeWidth: 1.75 };
const LAYOUT = { type: 'spring', stiffness: 420, damping: 36 };
const POP = {
  initial: { opacity: 0, scale: 0.6 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.6 },
  transition: { duration: 0.18, ease: 'easeOut' },
};
const MENU_ITEM = 'h-10 cursor-pointer justify-center rounded-full text-sm font-medium text-[var(--quiet-fg)]';

export default function FlybyControl({
  scenes, playingIndex, reordering, onAdd, onPlay, onStop, onStartReorder, onReorder, onEndReorder, onStartOver,
}) {
  const playing = playingIndex != null;

  if (scenes.length === 0) {
    return (
      <motion.button
        layoutId="flyby-root"
        type="button"
        onClick={onAdd}
        className={`${QUIET} h-10 gap-2 px-4 text-sm font-medium`}
        style={SANS}
        aria-label="Add the current view as a flyby scene"
      >
        <Video {...ICON} />
        Scene
      </motion.button>
    );
  }

  const single = scenes.length === 1;
  const labelledPlay = single && !playing && !reordering;
  const numberCells = scenes.map((scene, i) => (
    <motion.span
      key={scene.id}
      {...POP}
      animate={{ opacity: playing && i > playingIndex ? 0.4 : 1, scale: 1 }}
      className="flex h-10 w-8 shrink-0 items-center justify-center"
    >
      {i + 1}
    </motion.span>
  ));
  const numbersHost = `${METAL_HOST} h-10 text-sm font-medium tabular-nums ${single ? 'w-10' : 'px-3'}`;

  return (
    <motion.div layoutId="flyby-root" className="flex items-center gap-2" transition={LAYOUT} style={SANS}>
      {/* Play / Stop (metal while playing) / Done */}
      <motion.div layout transition={LAYOUT} className="flex">
        <Metal variant={labelledPlay ? 'button' : 'circle'} active={playing}>
          <button
            type="button"
            onClick={reordering ? onEndReorder : playing ? onStop : onPlay}
            className={`${METAL_HOST} h-10 ${labelledPlay ? 'gap-2 pr-4 pl-3.5 text-sm font-medium' : 'w-10'}`}
            aria-label={reordering ? 'Done reordering' : playing ? 'Stop flyby' : 'Play flyby'}
          >
            {reordering ? <Check {...ICON} /> : playing ? <Square {...ICON} /> : <Play {...ICON} />}
            {labelledPlay && <span>Play</span>}
          </button>
        </Metal>
      </motion.div>

      {/* Scene numbers (metal while playing) — a menu trigger normally, a drag-to-reorder strip
          while reordering */}
      <motion.div layout transition={LAYOUT} className="flex">
        <Metal variant="button" active={playing}>
          {reordering ? (
            <Reorder.Group as="div" axis="x" values={scenes} onReorder={onReorder} className={`${numbersHost} ring-1 ring-[var(--quiet-fg-muted)]`}>
              {scenes.map((scene) => (
                <Reorder.Item
                  as="span"
                  key={scene.id}
                  value={scene}
                  className="flex h-10 w-8 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
                  whileDrag={{ scale: 1.15 }}
                >
                  {/* Keep each scene's original number while dragging so you can see what moved. */}
                  {scene.label}
                </Reorder.Item>
              ))}
            </Reorder.Group>
          ) : (
            <Menu>
              <MenuTrigger
                disabled={playing}
                render={<button type="button" />}
                className={`${numbersHost} ${playing ? 'cursor-default' : ''}`}
                aria-label="Scene options"
              >
                <AnimatePresence initial={false} mode="popLayout">
                  {numberCells}
                </AnimatePresence>
              </MenuTrigger>
              <MenuPanel
                side="bottom"
                align="start"
                sideOffset={8}
                className="quiet-panel flex w-[186px] flex-col rounded-[24px] border-0 px-3 py-4"
                style={{ ...SANS, '--accent': 'var(--quiet-tint)', '--accent-foreground': 'var(--quiet-fg)' }}
              >
                <MenuItem className={MENU_ITEM} disabled={single} onClick={onStartReorder}>
                  Reorder
                </MenuItem>
                <MenuItem className={MENU_ITEM} onClick={onStartOver}>
                  Start over
                </MenuItem>
              </MenuPanel>
            </Menu>
          )}
        </Metal>
      </motion.div>

      {/* Add scene */}
      <AnimatePresence initial={false} mode="popLayout">
        {!playing && !reordering && scenes.length < MAX_SCENES && (
          <motion.button
            key="add"
            {...POP}
            layout
            type="button"
            onClick={onAdd}
            className={`${QUIET} size-10`}
            aria-label="Add the current view as a flyby scene"
          >
            <Plus {...ICON} />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
