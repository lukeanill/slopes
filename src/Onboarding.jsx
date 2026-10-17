import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import OnboardingClip from './OnboardingClips.jsx';
import { EASE_OUT, PanelOverlay, SANS, SERIF, panelVariants } from './overlayPanels.jsx';

// First-time walkthrough from the SLOPES Figma (node 27:60): one card, four steps, each with a
// looping clip of the real app (OnboardingClips.jsx). Shown once per browser; "Get started", Skip
// or Escape closes it for good.
export const ONBOARDED_KEY = 'slopes:onboarded';

export function hasOnboarded() {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return true; // storage blocked: don't nag on every visit
  }
}

const STEPS = [
  { light: 'Instant', bold: <><em>slope</em> analysis</>, body: 'Zoom in anywhere and the land lights up with its slope, from gentle flats to steep ground.' },
  { light: 'Parcel-level', bold: <><em>slope</em> insights</>, body: 'Tap any parcel to see how steep it really is, with its average, range and slope breakdown at a glance.' },
  { light: 'Customize', bold: <>the <em>look</em></>, body: 'Switch between dark and light maps, pick a slope palette and set how strongly it shows.' },
  { light: 'Make a', bold: <><em>flyby</em> video</>, body: 'Save up to eight views as scenes, then press play for a sweeping flight between them.' },
];

const PILL =
  'h-11 w-40 cursor-pointer rounded-full border border-current text-[15px] tracking-[0.15px] transition-opacity hover:opacity-80 disabled:cursor-default disabled:opacity-50';

export function markOnboarded() {
  try {
    localStorage.setItem(ONBOARDED_KEY, '1');
  } catch {
    // storage unavailable — it may show again next visit
  }
}

// `onClose` is called on "Get started" or Escape; the page places the Skip pill (top right).
// Clicking outside the card doesn't close it.
export default function Onboarding({ open, onClose }) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;
  const s = STEPS[step];

  return (
    <PanelOverlay open={open} onClose={onClose} closeOnScrim={false}>
      <motion.section
        custom={0}
        variants={panelVariants}
        initial="hidden"
        animate="shown"
        exit="exit"
        aria-label="Welcome to SLOPES"
        className="mx-auto flex w-full max-w-[795px] flex-col items-center gap-8 rounded-[14px] bg-[var(--glass-bg-panel)] px-4 py-8 text-[var(--glass-fg)] backdrop-blur-xl sm:gap-10 sm:px-6 sm:py-10"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE_OUT } }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}
            className="flex w-full flex-col items-center gap-8 sm:gap-10"
          >
            <div className="flex flex-col items-center gap-1 text-center">
              <p className="text-[14px] leading-[1.4] tracking-[0.14px]" style={SANS}>
                {step + 1} of {STEPS.length}
              </p>
              <h2 className="text-[32px] leading-[1.4] sm:text-[40px]" style={SERIF}>
                <span style={{ fontWeight: 200 }}>{s.light}</span>
                <br />
                <span style={{ fontWeight: 800 }}>{s.bold}</span>
              </h2>
              <p className="max-w-[460px] text-[15px] leading-[1.4] tracking-[0.15px] opacity-80" style={SANS}>
                {s.body}
              </p>
            </div>
            <div className="aspect-[635/185] w-full max-w-[635px] overflow-hidden rounded-[8px]">
              <OnboardingClip step={step} />
            </div>
          </motion.div>
        </AnimatePresence>
        {/* Beta notice (Figma 29:268), the same on every step. */}
        <p
          className="w-full max-w-[635px] rounded-[8px] bg-[rgba(255,243,107,0.24)] px-3 py-2 text-center text-[15px] leading-[1.4] tracking-[0.15px]"
          style={SANS}
        >
          This site is smoother to use on a laptop whilst in beta.
        </p>
        <div className="flex w-full items-center justify-center gap-4" style={{ ...SANS, fontWeight: 600 }}>
          <button type="button" className={PILL} disabled={step === 0} onClick={() => setStep((n) => n - 1)}>
            Prev
          </button>
          <button type="button" className={PILL} onClick={() => (last ? onClose() : setStep((n) => n + 1))}>
            {last ? 'Get started' : 'Next'}
          </button>
        </div>
      </motion.section>
    </PanelOverlay>
  );
}
