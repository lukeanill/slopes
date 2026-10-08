import { useEffect, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { Slide } from '@lukeanill/ui/components/animate-ui/primitives/effects/slide';
import { ShimmeringText } from '@lukeanill/ui/components/animate-ui/primitives/texts/shimmering';
import { RollingText } from '@lukeanill/ui/components/animate-ui/primitives/texts/rolling';

// Top-center status message. Every change — appearing, disappearing, or swapping one message for
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

export default function StatusMessage({ status }) {
  const key = status ? `${status.kind}:${status.text ?? status.label}` : null;
  return (
    <div className="status-slot">
      <AnimatePresence mode="wait" initial={false}>
        {status && (
          <Slide key={key} direction="down" offset={90} transition={SLIDE_TRANSITION} className="status-pill">
            {status.kind === 'prompt' ? (
              <ShimmeringText text={status.text} duration={2.3} wave color="#ffffff" shimmeringColor="rgba(255, 255, 255, 0.4)" />
            ) : status.kind === 'loading' ? (
              <RepeatingRollingText text={status.label} />
            ) : (
              <span>{status.text}</span>
            )}
          </Slide>
        )}
      </AnimatePresence>
    </div>
  );
}
