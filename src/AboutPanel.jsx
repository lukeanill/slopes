import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

// "About" overlay from the 100DS Figma frame (node 2369:223): a glass pill top-right that opens
// two frosted panels over the map. The frame's ABC Diatype Mono / Söhne / Google Sans Code
// aren't in the design system's font set, so the closest loaded faces stand in: Geist Mono for
// the mono headings and steps, Inter Light for body copy.
const MONO = { fontFamily: "'Geist Mono', ui-monospace, monospace", fontWeight: 300 };
const SANS = { fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 300 };
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
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-[#dd7ff4]">
      {children}
    </a>
  );
}

const STEPS = [
  {
    title: '1. Get elevation data',
    body: (
      <>
        Usually a DEM or LiDAR-derived dataset. In the US, USGS 3DEP provides DEMs from roughly 30m down to 1m
        resolution, free and without use restrictions. <Link href="https://www.usgs.gov/3d-elevation-program">USGS</Link>
      </>
    ),
  },
  {
    title: '2. Get parcel geometry',
    body: (
      <>
        From county GIS systems or a commercial parcel-data provider. For example,{' '}
        <Link href="https://www.attomdata.com/">ATTOM</Link> supplies boundaries for 160M+ US properties.{' '}
        <Link href="https://www.attomdata.com/data/boundaries-data/parcel-boundaries/">ATTOM</Link>
      </>
    ),
  },
  {
    title: '3. Do the GIS work',
    body: (
      <>
        Match the parcel polygon to the elevation raster → calculate slope for the underlying cells → clip it to the
        parcel → aggregate the results. Creating slope from elevation is itself a GIS analysis step; tools such as
        ArcGIS expose dedicated slope-processing workflows.{' '}
        <Link href="https://support.esri.com/en-us/knowledge-base/how-to-create-a-slope-map-using-las-files-in-arcgis-pro-000034008">
          Esri Support
        </Link>
      </>
    ),
  },
  {
    title: '4. Invent the property metrics',
    body: (
      <>
        The platform still needs to decide what actually matters:
        <br />
        min slope · max slope · median · % &gt; 30% · dominant slope · distribution
      </>
    ),
  },
  {
    title: '5. Build infrastructure',
    body: 'Process millions of parcels, cache results, handle different DEM resolutions/coverage, update datasets and expose everything through their own API/database.',
  },
  {
    title: '6. Build the UX',
    body: 'Finally turn all that into something a developer or agent can actually understand.',
  },
];

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

const PANEL = 'w-full rounded-[28px] bg-[rgba(16,15,15,0.4)] p-6 backdrop-blur-xl sm:rounded-[40px] sm:p-20';

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
        className="about-button fixed top-4 right-4 z-[60] h-11 cursor-pointer rounded-full border border-white/25 bg-[rgba(16,15,15,0.45)] px-5 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_4px_16px_rgba(0,0,0,0.25)] backdrop-blur-md transition-colors hover:bg-[rgba(16,15,15,0.6)]"
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
              <motion.section custom={0} variants={panelVariants} initial="hidden" animate="shown" exit="exit" className={`${PANEL} flex flex-col items-center gap-10 text-white`}>
                <div className="flex flex-col items-center gap-6 text-center">
                  <h2 className="text-[22px] leading-[1.6] sm:text-[28px]" style={MONO}>
                    Parcel-level slope
                    <br />
                    intelligence
                  </h2>
                  <p className="text-[15px] leading-[1.4] tracking-[0.15px]" style={SANS}>
                    Unearth real build potential
                  </p>
                </div>
                <div className="grid w-full grid-cols-1 gap-4 text-center sm:grid-cols-2 sm:gap-10" style={SANS}>
                  {BENEFITS.map((b) => (
                    <div key={b.title} className="flex flex-col items-center justify-center gap-2 rounded-[14px] border border-white/15 bg-[rgba(17,15,15,0.1)] p-6">
                      <p className="text-[14px] leading-[1.4] tracking-[0.14px]">{b.title}</p>
                      <p className="text-[13px] leading-[1.4] tracking-[0.13px] opacity-65">{b.body}</p>
                    </div>
                  ))}
                </div>
              </motion.section>

              <motion.section custom={1} variants={panelVariants} initial="hidden" animate="shown" exit="exit" className={`${PANEL} flex flex-col items-center gap-10 text-white`}>
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="flex gap-2" style={SANS}>
                    {['Private beta', 'Nerds only'].map((tag) => (
                      <span key={tag} className="rounded-lg bg-[#2c0433] px-2.5 py-1 text-[13px] leading-[1.6] tracking-[1.04px]">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <h2 className="text-[20px] leading-[1.6] sm:text-[23px]" style={MONO}>Here’s the deal.</h2>
                  <p className="text-[13px] leading-[1.4] tracking-[0.13px] opacity-65" style={SANS}>
                    Tap a button above and explore.
                    <br />
                    Or, do it the good ‘ol current way...
                  </p>
                </div>
                <ol className="flex w-full max-w-[795px] flex-col gap-4 text-[13px] leading-[2] text-white sm:text-[14px]" style={MONO}>
                  {STEPS.map((step) => (
                    <li key={step.title}>
                      <span className="text-[#dd7ff4]">{step.title}</span>
                      <br />
                      {step.body}
                    </li>
                  ))}
                </ol>
              </motion.section>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
