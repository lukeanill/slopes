import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { readableOnDark } from './colorContrast.js';

// Adaptation of the design system's NotificationList
// (@lukeanill/ui/components/animate-ui/components/community/notification-list): the same
// stacked cards that fan out on hover, with the same spring — but fed real data (the stock
// component renders a hard-coded list) and without the count/"View all" footer. Touch screens
// have no hover, so the first tap on a collapsed stack expands it instead of navigating.
const transition = { type: 'spring', stiffness: 300, damping: 26 };
const PEEK = 3; // cards visible behind the top one while collapsed

// Cards use the same dark glass as the search and About buttons. Glass is see-through, so the
// back cards' text would show through the top card while stacked — it fades out until the
// stack fans open, leaving just their glass edges peeking out below.
// Heavier blur than the buttons: the cards carry text over busy map detail.
const GLASS = 'border border-white/25 bg-[rgba(16,15,15,0.45)] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_4px_16px_rgba(0,0,0,0.25)] backdrop-blur-3xl';
const contentVariants = (i) => ({
  collapsed: { opacity: i === 0 ? 1 : 0, transition: { duration: 0.15 } },
  expanded: { opacity: 1, transition: { duration: 0.2, delay: 0.05 } },
});

const cardVariants = (i) => ({
  collapsed: {
    marginTop: i === 0 ? 0 : i < PEEK ? -44 : -56,
    scaleX: 1 - Math.min(i, PEEK - 1) * 0.05,
    opacity: i < PEEK ? 1 : 0,
  },
  expanded: { marginTop: i === 0 ? 0 : 4, scaleX: 1, opacity: 1 },
});

export default function ParcelHistory({ items, onSelect }) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  return (
    <motion.div
      layout
      className="w-full"
      initial="collapsed"
      animate={expanded ? 'expanded' : 'collapsed'}
      onHoverStart={() => setExpanded(true)}
      onHoverEnd={() => setExpanded(false)}
    >
      <AnimatePresence initial={false}>
        {items.map((item, i) => (
          <motion.button
            key={item.ain}
            type="button"
            layout
            variants={cardVariants(i)}
            transition={transition}
            exit={{ opacity: 0, scale: 0.95 }}
            style={{ zIndex: items.length - i, pointerEvents: !expanded && i >= PEEK ? 'none' : 'auto' }}
            onClick={() => (expanded ? onSelect(item) : setExpanded(true))}
            className={`relative block w-full cursor-pointer rounded-xl px-4 py-2 text-center text-white transition-colors duration-200 hover:bg-[rgba(16,15,15,0.6)] ${GLASS}`}
          >
            <motion.div variants={contentVariants(i)}>
              <div className="truncate text-sm font-medium">{item.title}</div>
              <div className="flex items-baseline justify-center gap-1.5 text-sm">
                <span className="font-semibold" style={{ color: readableOnDark(item.labelColor) }}>{item.label}</span>
                <span className="font-semibold" style={{ color: readableOnDark(item.modeColor) }}>{item.mode}%</span>
                <span className="text-white/60">{item.min}-{item.max}%</span>
              </div>
            </motion.div>
          </motion.button>
        ))}
      </AnimatePresence>
    </motion.div>
  );
}
