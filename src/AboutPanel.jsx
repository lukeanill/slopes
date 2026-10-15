import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import arrowIcon from './assets/about/arrow.svg';

// "About" overlay from the SLOPES Figma (node 2:291): a glass pill top-right that opens two frosted
// panels over the map. Headings in Migra (Extralight from the design system, Extrabold registered
// in style.css); Söhne → Inter, as elsewhere in the app.
const SERIF = { fontFamily: "'Migra', Georgia, serif", fontFeatureSettings: '"calt" 0, "liga" 0' };
const SANS = { fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 300 };
const SANS_BOLD = { fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 500 };
const EASE_OUT = [0.22, 1, 0.36, 1];

const BENEFITS = [
  {
    title: 'Terrain changes the potential of a property.',
    body: 'It’s often painful to assess until relatively late in an evaluation process. Now it’s simple.',
  },
  {
    title: 'This is built for property, not GIS.',
    body: 'Traditional terrain tools tell you about geography. We tell you about properties.',
  },
  {
    title: 'Add a new layer of property intelligence.',
    body: 'Enrich property data with terrain characteristics your users can immediately understand.',
  },
  {
    title: 'Find promising sites faster.',
    body: 'Use slope as an early screening signal before investing time in detailed due diligence.',
  },
];

function Link({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-80">
      {children}
    </a>
  );
}

const STEPS = [
  {
    title: 'Get elevation data',
    body: (
      <>
        Usually a DEM or LiDAR-derived dataset. In the US, USGS 3DEP provides DEMs from roughly 30m down to 1m
        resolution, free and without use restrictions. <Link href="https://www.usgs.gov/3d-elevation-program">USGS</Link>
      </>
    ),
  },
  {
    title: 'Get parcel geometry',
    body: (
      <>
        From county GIS systems or a commercial parcel-data provider. For example,{' '}
        <Link href="https://www.attomdata.com/">ATTOM</Link> supplies boundaries for 160M+ US properties.{' '}
        <Link href="https://www.attomdata.com/data/boundaries-data/parcel-boundaries/">ATTOM</Link>
      </>
    ),
  },
  {
    title: 'Do the GIS work',
    body: 'Match the parcel polygon to the elevation raster → calculate slope for the underlying cells → clip it to the parcel → aggregate the results. Creating slope from elevation is itself a GIS analysis step.',
  },
  {
    title: 'Invent the property metrics',
    body: 'The platform still needs to decide what actually matters: min slope · max slope · median · % > 30% · dominant slope · distribution',
  },
  {
    title: 'Build infrastructure',
    body: 'Process millions of parcels, cache results, handle different DEM resolutions/coverage, update datasets and expose everything through their own API/database.',
  },
  {
    title: 'Build the UX',
    body: 'Finally turn all that into something a developer or agent can understand – and enjoy.',
  },
];

// Small print, as written in the design.
const TERMS = [
  { p: 'SLOPES at slopes.lukeai.space (the “Site”) is operated by Luke AI Ltd (“we”, “us”, “our”), a company registered in England and Wales under company number 16175331, with its registered office at 5 Foundry Close, Eccles, Manchester, England, M30 9QX.' },
  { p: 'These terms apply to your use of the Site. By using it, you agree to them. If you don’t agree, please don’t use the Site.' },
  { h: '1. Ownership' },
  { p: 'The Site and its content, including the design, code, text, graphics and the SLOPES name, belong to Luke AI Ltd, unless stated otherwise. © 2026 Luke AI Ltd. All rights reserved.' },
  { p: 'You may not copy, reproduce, modify, distribute or create derivative works from any part of the Site without our written permission.' },
  { h: '2. Permitted use' },
  { p: 'You may use the Site for personal, non-commercial purposes. You agree not to:' },
  {
    list: [
      'use it for anything unlawful or harmful',
      'try to hack, disrupt, scrape or reverse-engineer it',
      'copy its design or functionality to build a competing product',
      'misrepresent your connection to us or the Site',
    ],
  },
  { h: '3. Third-party content' },
  { p: 'Some parts of the Site use third-party tools, libraries or content. These remain the property of their respective owners and are subject to their own licences.' },
  { h: '4. Your content and AI output' },
  { p: 'If you submit content to the Site, you keep ownership of it. You give us permission to use it only as needed to run the Site. Any AI-generated output is provided “as is” and may be inaccurate, so please check anything important before relying on it.' },
  { h: '5. Governing law' },
  { p: 'These terms are governed by the laws of England and Wales. The courts of England and Wales have exclusive jurisdiction.' },
];

// A column heading in the display serif, with one italic word, and the long down-arrow beneath it.
function ColumnHeading({ children }) {
  return (
    <div className="flex w-full flex-col gap-6 pb-6">
      <p className="max-w-[366px] text-[32px] leading-[1.4] sm:text-[40px]" style={{ ...SERIF, fontWeight: 200 }}>
        {children}
      </p>
      {/* Rotating doesn't change layout size, so reserve the arrow's drawn height. */}
      <div className="h-[70px] px-10">
        <img src={arrowIcon} alt="" width={64.75} height={11.05} className="theme-mono-icon block origin-left translate-x-[5.5px] rotate-90" />
      </div>
    </div>
  );
}

// Panels rise in one after the other, un-blurring as they land; they leave together, quicker.
const panelVariants = {
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

const PANEL = 'w-full rounded-[28px] bg-[var(--glass-bg-panel)] p-6 backdrop-blur-xl sm:rounded-[40px] sm:p-20';

export default function AboutPanel({ onOpenChange }) {
  const [open, setOpen] = useState(false);

  // Lets the page move its other controls aside while About is open.
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setOpen((o) => !o)}
        whileTap={{ scale: 0.96 }}
        aria-expanded={open}
        className="about-button fixed top-4 right-4 z-[60] h-11 cursor-pointer glass rounded-full px-5 text-sm backdrop-blur-md transition-colors hover:bg-[var(--glass-bg-hover)]"
        style={SANS}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={open ? 'close' : 'about'}
            className="block"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            {open ? 'Close' : 'About'}
          </motion.span>
        </AnimatePresence>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="about-overlay"
            className="fixed inset-0 z-[55] overflow-y-auto"
            // Light scrim only — in the design the map stays clearly visible around the panels; the
            // frosting comes from each panel's own backdrop blur.
            initial={{ backgroundColor: 'rgba(4,4,4,0)' }}
            animate={{ backgroundColor: 'rgba(4,4,4,0.12)', transition: { duration: 0.35, ease: EASE_OUT } }}
            exit={{ backgroundColor: 'rgba(4,4,4,0)', transition: { duration: 0.25, ease: 'easeIn' } }}
            onClick={(e) => e.target === e.currentTarget && setOpen(false)}
          >
            <div
              className="mx-auto flex w-full max-w-[955px] flex-col gap-5 px-4 pt-20 pb-16 sm:gap-10 sm:pt-[70px]"
              onClick={(e) => e.target === e.currentTarget && setOpen(false)}
            >
              <motion.section custom={0} variants={panelVariants} initial="hidden" animate="shown" exit="exit" className={`${PANEL} flex flex-col items-center gap-10 text-[var(--glass-fg)]`}>
                <div className="flex flex-col items-center gap-4 text-center">
                  <h2 className="text-[38px] leading-[1.4] sm:text-[52px]" style={SERIF}>
                    <span style={{ fontWeight: 200 }}>Parcel-level</span>
                    <br />
                    <span style={{ fontWeight: 800 }}>
                      <em>slope</em> intelligence
                    </span>
                  </h2>
                  <p className="text-[15px] leading-[1.4] tracking-[0.15px]" style={SANS}>
                    Unearth real build potential
                  </p>
                </div>
                <div className="grid w-full grid-cols-1 gap-4 text-center sm:grid-cols-2 sm:gap-10" style={SANS}>
                  {BENEFITS.map((b) => (
                    <div key={b.title} className="flex flex-col items-center justify-center gap-2 rounded-[14px] bg-[var(--glass-tint)] p-6">
                      <p className="text-[14px] leading-[1.4] tracking-[0.14px]">{b.title}</p>
                      <p className="text-[13px] leading-[1.4] tracking-[0.13px] opacity-65">{b.body}</p>
                    </div>
                  ))}
                </div>
              </motion.section>

              <motion.section custom={1} variants={panelVariants} initial="hidden" animate="shown" exit="exit" className={`${PANEL} flex flex-col items-center gap-12 text-[var(--glass-fg)] sm:gap-16`}>
                <span className="rounded-lg bg-white/80 px-2.5 py-1 text-[15px] leading-[1.6] tracking-[1.2px] text-black" style={SANS_BOLD}>
                  Private beta
                </span>
                <div className="grid w-full grid-cols-1 gap-16 sm:grid-cols-2 sm:gap-20">
                  <div className="flex flex-col gap-6">
                    <ColumnHeading>
                      You <em>could</em> make this from scratch, yourself.
                    </ColumnHeading>
                    <div className="flex flex-col gap-4 text-[15px] leading-[1.4] tracking-[0.15px]">
                      {STEPS.map((step) => (
                        <div key={step.title} className="flex flex-col gap-2">
                          <p style={SANS_BOLD}>{step.title}</p>
                          <p className="opacity-75" style={SANS}>{step.body}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-6">
                    <ColumnHeading>
                      Or we <em>will</em> make this better, and more.
                    </ColumnHeading>
                    <div className="flex flex-col gap-6 text-[15px] leading-[1.4] tracking-[0.15px]">
                      <div className="flex flex-col gap-2">
                        <p style={SANS_BOLD}>Made by Luke &amp; Claude.</p>
                        <p className="opacity-75" style={SANS}>
                          An AI native designer. On a mission to craft 100 diverse, yet meaningful, AI prototypes. Backed by a highly themable AI developed design system.
                        </p>
                      </div>
                      <a href="https://uk.linkedin.com/in/lukeillidge" target="_blank" rel="noopener noreferrer" className="w-fit underline underline-offset-2 hover:opacity-80" style={SANS_BOLD}>
                        Get in touch
                      </a>
                    </div>
                    <div className="flex flex-col gap-5 py-10 opacity-75" style={SANS}>
                      <p className="text-[12px] leading-[1.4] tracking-[0.12px]">
                        Copyright 2026. Luke AI Ltd.
                        <br />
                        Registered in England and Wales.
                      </p>
                      <div className="text-[8px] leading-[1.4] tracking-[0.08px]">
                        {TERMS.map((t, i) =>
                          t.list ? (
                            <ul key={i} className="list-disc">
                              {t.list.map((item) => (
                                <li key={item} className="ms-3">{item}</li>
                              ))}
                            </ul>
                          ) : t.h ? (
                            <p key={i} className="mt-[1.4em]">{t.h}</p>
                          ) : (
                            <p key={i}>{t.p}</p>
                          ),
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.section>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
