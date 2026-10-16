import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';

// Shared by the top-right overlays (About, Message): frosted panels that rise over the map, with
// headings in Migra (Extralight from the design system, Extrabold registered in style.css) and
// Söhne → Inter, as elsewhere in the app.
export const SERIF = { fontFamily: "'Migra', Georgia, serif", fontFeatureSettings: '"calt" 0, "liga" 0' };
export const SANS = { fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 300 };
export const SANS_BOLD = { fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 500 };
export const EASE_OUT = [0.22, 1, 0.36, 1];

// Panels rise in one after the other, un-blurring as they land; they leave together, quicker.
export const panelVariants = {
  hidden: { opacity: 0, y: 28, scale: 0.98, filter: 'blur(8px)' },
  shown: (i) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    filter: 'blur(0px)',
    transition: { duration: 0.55, ease: EASE_OUT, delay: 0.08 + i * 0.12 },
  }),
  exit: { opacity: 0, y: 12, filter: 'blur(6px)', transition: { duration: 0.2, ease: 'easeIn' } },
};

export const PANEL = 'w-full rounded-[28px] bg-[var(--glass-bg-panel)] p-6 backdrop-blur-xl sm:rounded-[40px] sm:p-20';

// The full-screen layer the panels sit in. Rendered into <body>, so the top-right buttons (which
// fade and shift aside with the rest of the controls) never become its containing block. Click
// the scrim or press Escape to close.
export function PanelOverlay({ open, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="panel-overlay"
          className="panel-overlay fixed inset-0 z-[55] overflow-y-auto"
          // Light scrim only — in the design the map stays clearly visible around the panels; the
          // frosting comes from each panel's own backdrop blur.
          initial={{ backgroundColor: 'rgba(4,4,4,0)' }}
          animate={{ backgroundColor: 'rgba(4,4,4,0.12)', transition: { duration: 0.35, ease: EASE_OUT } }}
          exit={{ backgroundColor: 'rgba(4,4,4,0)', transition: { duration: 0.25, ease: 'easeIn' } }}
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          <div
            className="mx-auto flex w-full max-w-[955px] flex-col gap-5 px-4 pt-20 pb-16 sm:gap-10 sm:pt-[70px]"
            onClick={(e) => e.target === e.currentTarget && onClose()}
          >
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
