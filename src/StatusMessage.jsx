import { useEffect, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { Slide } from '@lukeanill/ui/components/animate-ui/primitives/effects/slide';
import { ShimmeringText } from '@lukeanill/ui/components/animate-ui/primitives/texts/shimmering';
import { RollingText } from '@lukeanill/ui/components/animate-ui/primitives/texts/rolling';

// Top-center status messages. Every change — appearing, disappearing, or swapping one message for
// another — slides the box up out of view and the next one down in (design system Slide), so the
// eye always reads it as a new message. Per kind:
//   prompt  → wave shimmer   ("Zoom in for slope analysis")
//   info    → static text    ("Little slope in this area")
//   loading → rolling text that replays until loading finishes ("Wrangling slope analysis")
const SLIDE_TRANSITION = { type: 'spring', stiffness: 380, damping: 32 };
const ROLL_EVERY_MS = 2200;
const ROLL_TRANSITION = { duration: 0.45, delay: 0.025, ease: 'easeOut' };

function RepeatingRollingText({ text }) {
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setCycle((c) => c + 1), ROLL_EVERY_MS);
    return () => clearInterval(id);
  }, []);
  // RollingText plays once on mount, so remounting it (new key) replays the roll.
  return <RollingText key={cycle} text={text} transition={ROLL_TRANSITION} />;
}

// The shimmer animates its colors with Motion, which resolves them to fixed values when the
// animation starts — CSS variables wouldn't follow a theme change — so it gets each theme's
// colors explicitly and restarts (key) when the theme flips.
const SHIMMER_COLORS = {
  dark: { color: '#ffffff', shimmeringColor: 'rgba(255, 255, 255, 0.4)' },
  light: { color: '#111111', shimmeringColor: 'rgba(0, 0, 0, 0.35)' },
};

function Message({ status, uiMapTheme }) {
  if (status.kind === 'prompt') {
    const colors = SHIMMER_COLORS[uiMapTheme] ?? SHIMMER_COLORS.dark;
    return <ShimmeringText key={uiMapTheme} text={status.text} duration={2.3} wave {...colors} />;
  }
  if (status.kind === 'loading') return <RepeatingRollingText text={status.label} />;
  return <span>{status.text}</span>;
}

// One top-center slot holding either a status message or the flyby control (`flyby`), never both;
// switching between them uses the same slide out / slide in. The caller decides which: the
// message wins whenever there is one (zoom-in prompt, loading, a brief flat-area note).
export default function StatusMessage({ status, flyby, uiMapTheme }) {
  const key = flyby ? 'flyby' : status ? `${status.kind}:${status.text ?? status.label}` : null;
  return (
    <div className="status-slot">
      <AnimatePresence mode="wait" initial={false}>
        {flyby ? (
          <Slide key={key} direction="down" offset={90} transition={SLIDE_TRANSITION}>
            {flyby}
          </Slide>
        ) : status ? (
          <Slide key={key} direction="down" offset={90} transition={SLIDE_TRANSITION} className="status-pill">
            <Message status={status} uiMapTheme={uiMapTheme} />
          </Slide>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
