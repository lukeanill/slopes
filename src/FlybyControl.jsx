import { AnimatePresence, Reorder, motion } from 'motion/react';
import { Check } from 'lucide-react';
import { Menu, MenuTrigger, MenuPanel, MenuItem } from '@lukeanill/ui/components/animate-ui/components/base/menu';
import iconVideoCamera from './assets/flyby/video-camera.svg';
import iconSelectionPlus from './assets/flyby/selection-plus.svg';
import iconPlay from './assets/flyby/play.svg';
import iconStopCircle from './assets/flyby/stop-circle.svg';

// Flyby builder from the SLOPES Figma (node 7:844). States:
//   none added   → one "Scene" pill that captures the first scene
//   1..7 added   → [Play] [scene numbers] [+]   (Play is a labelled pill with a single scene)
//   8 added      → [Play] [scene numbers]       (no more scenes allowed)
//   playing      → [Stop] [numbers, scenes not yet reached dimmed]
//   numbers menu → tapping the numbers opens Reorder / Start over
//   reordering   → numbers drag sideways; the Play slot becomes Done
export const MAX_SCENES = 8;

// The Figma's Söhne isn't loaded; Inter stands in, as in the About panel.
const SANS = { fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 400 };
const NUMBERS = { fontFamily: "'Staatliches', sans-serif", fontSize: 18, letterSpacing: '0.18px' };
const GLASS =
  'glass backdrop-blur-md';
const BUTTON = `${GLASS} flex h-10 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-[var(--glass-bg-hover)]`;
const LAYOUT = { type: 'spring', stiffness: 420, damping: 36 };
const POP = {
  initial: { opacity: 0, scale: 0.6 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.6 },
  transition: { duration: 0.18, ease: 'easeOut' },
};

// The icons are white SVGs; `mono` ones are inverted to black on the light theme (see style.css).
function Icon({ src, size = 24, mono = true }) {
  return <img src={src} alt="" width={size} height={size} className={`block shrink-0 ${mono ? 'theme-mono-icon' : ''}`} draggable={false} />;
}

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
        className={`${GLASS} flex h-12 cursor-pointer items-center gap-4 rounded-full px-6 text-sm tracking-[0.14px] transition-colors hover:bg-[var(--glass-bg-hover)]`}
        style={SANS}
        aria-label="Add the current view as a flyby scene"
      >
        <Icon src={iconVideoCamera} size={16} />
        <span className="flex items-center gap-2">
          <Icon src={iconSelectionPlus} />
          Scene
        </span>
      </motion.button>
    );
  }

  const single = scenes.length === 1;
  const numberCells = scenes.map((scene, i) => (
    <motion.span
      key={scene.id}
      {...POP}
      animate={{ opacity: playing && i > playingIndex ? 0.4 : 1, scale: 1 }}
      className="flex size-10 shrink-0 items-center justify-center leading-[1.4]"
    >
      {i + 1}
    </motion.span>
  ));
  const numbersClass = `${GLASS} flex h-10 items-center justify-center overflow-hidden rounded-full ${single ? 'w-10' : 'px-3'}`;

  return (
    <motion.div layoutId="flyby-root" className="flex items-center gap-2" transition={LAYOUT}>
      {/* Play / Stop / Done */}
      <motion.button
        layout
        transition={LAYOUT}
        type="button"
        onClick={reordering ? onEndReorder : playing ? onStop : onPlay}
        className={`${BUTTON} ${single && !playing && !reordering ? 'gap-1 px-4 text-sm tracking-[0.14px]' : 'w-10'}`}
        style={SANS}
        aria-label={reordering ? 'Done reordering' : playing ? 'Stop flyby' : 'Play flyby'}
      >
        {reordering ? (
          <Check size={20} strokeWidth={1.75} />
        ) : (
          <Icon src={playing ? iconStopCircle : iconPlay} mono={!playing} />
        )}
        {single && !playing && !reordering && <span>Play</span>}
      </motion.button>

      {/* Scene numbers — a menu trigger normally, a drag-to-reorder strip while reordering */}
      {reordering ? (
        <Reorder.Group
          as="div"
          axis="x"
          values={scenes}
          onReorder={onReorder}
          layout
          transition={LAYOUT}
          className={`${numbersClass} ring-1 ring-[var(--glass-fg-muted)]`}
          style={NUMBERS}
        >
          {scenes.map((scene) => (
            <Reorder.Item
              as="span"
              key={scene.id}
              value={scene}
              className="flex size-10 shrink-0 cursor-grab touch-none items-center justify-center leading-[1.4] active:cursor-grabbing"
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
            render={<motion.button layout transition={LAYOUT} type="button" />}
            className={`${numbersClass} ${playing ? 'cursor-default' : 'cursor-pointer hover:bg-[var(--glass-bg-hover)]'} transition-colors`}
            style={NUMBERS}
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
            className={`${GLASS} flex w-[186px] flex-col rounded-[24px] border-[var(--glass-border)] bg-[var(--glass-bg-panel)] px-3 py-4 text-[var(--glass-fg)] shadow-[inset_0_1px_0_var(--glass-highlight),0_4px_16px_var(--glass-shadow)] backdrop-blur-xl`}
            style={{ ...SANS, '--accent': 'var(--glass-tint)', '--accent-foreground': 'var(--glass-fg)' }}
          >
            <MenuItem
              className="h-10 cursor-pointer justify-center rounded-full text-sm tracking-[0.14px] text-[var(--glass-fg)]"
              disabled={single}
              onClick={onStartReorder}
            >
              Reorder
            </MenuItem>
            <MenuItem className="h-10 cursor-pointer justify-center rounded-full text-sm tracking-[0.14px] text-[var(--glass-fg)]" onClick={onStartOver}>
              Start over
            </MenuItem>
          </MenuPanel>
        </Menu>
      )}

      {/* Add scene */}
      <AnimatePresence initial={false} mode="popLayout">
        {!playing && !reordering && scenes.length < MAX_SCENES && (
          <motion.button
            key="add"
            {...POP}
            layout
            type="button"
            onClick={onAdd}
            className={`${BUTTON} w-10`}
            aria-label="Add the current view as a flyby scene"
          >
            <Icon src={iconSelectionPlus} />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
