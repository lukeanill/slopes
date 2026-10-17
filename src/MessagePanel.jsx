import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { MessageCircle } from 'lucide-react';
import { EASE_OUT, PANEL, PanelOverlay, SANS, SANS_BOLD, SERIF, panelVariants } from './overlayPanels.jsx';

// "Message" overlay from the SLOPES Figma (section 23:581): a round button beside About that opens
// one frosted panel. Pick what it's about, then:
//   idea     → a few pointers, then name / email / the idea / why it matters
//   issue    → name / location / device and browser / what happened
//   together → ways to reach Luke directly
// Sending (all fields required) saves the message to Vercel Blob via /api/message and shows the
// "You're a legend" confirmation.

const TOPICS = [
  { id: 'idea', label: 'I have an idea', reply: 'Let’s gooooo' },
  { id: 'issue', label: 'I found an issue', reply: 'Nice one for this' },
  { id: 'together', label: 'Lets work together', reply: 'Buckle up' },
];

const FIELDS = {
  idea: [
    { name: 'name', label: 'Your name', placeholder: 'Your name', autoComplete: 'name' },
    { name: 'email', label: 'email', placeholder: 'Your email', type: 'email', autoComplete: 'email' },
    { name: 'idea', label: 'what’s the idea? who benefits and why?', placeholder: 'Just a couple of sentences is great, we can chat more', multiline: true },
    { name: 'importance', label: 'how important is it to you, and why?', placeholder: 'Will this change your life?', multiline: true },
  ],
  issue: [
    { name: 'name', label: 'Your name', placeholder: 'Your name', autoComplete: 'name' },
    { name: 'location', label: 'location', placeholder: 'e.g. Country and city' },
    { name: 'device', label: 'device and browser of use', placeholder: 'e.g.iPhone with safari' },
    {
      name: 'issue',
      label: 'what’s up',
      placeholder: 'e.g. I was trying to {your intention} but when I clicked {your action} {this issue happened} which {what was the impact- couldn’t use, didn’t trust data etc. }',
      multiline: true,
      tall: true,
    },
  ],
};

const CONTACTS = [
  { label: 'LinkedIn', href: 'https://uk.linkedin.com/in/lukeillidge', external: true, underline: true },
  { label: '+44 7447 616002', href: 'tel:+447447616002' },
  { label: 'lukeaillidge@gmail.com', href: 'mailto:lukeaillidge@gmail.com' },
];

const TEXT = 'text-[14px] leading-[1.4] tracking-[0.14px]';
const INPUT = `w-full rounded-[9px] bg-[color-mix(in_srgb,var(--quiet-bg)_60%,transparent)] text-[var(--quiet-fg)] outline-none placeholder:text-[var(--quiet-fg-muted)] focus:ring-1 focus:ring-[var(--quiet-fg-muted)] ${TEXT}`;
const REVEAL = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE_OUT } } };

function Contacts() {
  return (
    <ul className="flex flex-col text-[15px] leading-[1.4] tracking-[0.15px]" style={SANS_BOLD}>
      {CONTACTS.map((c) => (
        <li key={c.label} className="flex h-10 items-center">
          <a
            href={c.href}
            {...(c.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className={`hover:opacity-80 ${c.underline ? 'underline underline-offset-2' : ''}`}
          >
            {c.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Field({ field, value, onChange }) {
  const props = {
    id: `message-${field.name}`,
    name: field.name,
    required: true,
    placeholder: field.placeholder,
    value,
    onChange: (e) => onChange(field.name, e.target.value),
    style: SANS,
  };
  return (
    <label className="flex flex-col gap-1.5" htmlFor={props.id}>
      <span className={TEXT} style={SANS}>{field.label}</span>
      {field.multiline ? (
        <textarea {...props} className={`${INPUT} resize-none p-5 ${field.tall ? 'h-[143px]' : 'h-[120px]'}`} />
      ) : (
        <input {...props} type={field.type ?? 'text'} autoComplete={field.autoComplete} className={`${INPUT} h-11 px-3`} />
      )}
    </label>
  );
}

function IdeaPointers() {
  return (
    <motion.div {...REVEAL} className={`grid gap-6 sm:grid-cols-3 sm:gap-10 ${TEXT}`}>
      <div className="flex flex-col gap-2">
        <p style={SANS_BOLD}>You should give it a shot yourself using AI.</p>
        <p style={SANS}>
          I strongly recommend using Claude.{' '}
          <a href="https://vercel.com/lukeai-100/slopes" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-80">
            Grab the code
          </a>{' '}
          and/or request access.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <p style={SANS_BOLD}>If there’s a business growth and/or revenue opportunity here for you.</p>
        <p style={SANS}>
          Hit “Lets work together”
          <br />
          Call me if you’re a billionaire.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <p style={SANS_BOLD}>If there’s a: running cost, third-party access need, legal or ethical concern.</p>
        <p style={SANS}>I need you have the answers, and ability own this until the outcome.</p>
      </div>
    </motion.div>
  );
}

function MessageForm({ topic, onSent }) {
  const fields = FIELDS[topic];
  const [values, setValues] = useState({});
  const [status, setStatus] = useState('idle'); // idle | sending | error
  const [error, setError] = useState('');
  const set = (name, value) => setValues((v) => ({ ...v, [name]: value }));

  async function submit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    setStatus('sending');
    setError('');
    try {
      const res = await fetch('/api/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, fields: values, website: form.elements.website.value }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Something went wrong');
      onSent();
    } catch (err) {
      setStatus('error');
      setError(`${err.message}. Please try again.`);
    }
  }

  // Idea: two short fields across, then the two long ones. Issue: the short fields stacked on the
  // left, the long one on the right.
  const short = fields.filter((f) => !f.multiline);
  const long = fields.filter((f) => f.multiline);
  const send = (
    <div className="flex flex-col items-end gap-2">
      <button
        type="submit"
        disabled={status === 'sending'}
        className="h-12 w-40 cursor-pointer rounded-full bg-[var(--quiet-bg)] text-[15px] tracking-[0.15px] text-[var(--quiet-fg)] transition-colors hover:bg-[var(--quiet-bg-hover)] disabled:cursor-default disabled:opacity-60"
        style={{ ...SANS, fontWeight: 600 }}
      >
        {status === 'sending' ? 'Sending…' : 'Send'}
      </button>
      {status === 'error' && (
        <p role="alert" className={`${TEXT} opacity-75`} style={SANS}>
          {error}
        </p>
      )}
    </div>
  );

  return (
    <motion.form {...REVEAL} onSubmit={submit} className="flex flex-col gap-4">
      {/* Hidden from people; bots that fill in every field are quietly ignored by the server. */}
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
      {topic === 'idea' ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 sm:gap-10">
            {short.map((f) => <Field key={f.name} field={f} value={values[f.name] ?? ''} onChange={set} />)}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 sm:gap-10">
            {long.map((f) => <Field key={f.name} field={f} value={values[f.name] ?? ''} onChange={set} />)}
          </div>
          {send}
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 sm:gap-10">
          <div className="flex flex-col gap-4">
            {short.map((f) => <Field key={f.name} field={f} value={values[f.name] ?? ''} onChange={set} />)}
          </div>
          <div className="flex flex-col gap-6">
            {long.map((f) => <Field key={f.name} field={f} value={values[f.name] ?? ''} onChange={set} />)}
            {send}
          </div>
        </div>
      )}
    </motion.form>
  );
}

export default function MessagePanel({ onOpenChange }) {
  const [open, setOpenState] = useState(false);
  const [topic, setTopic] = useState(null);
  const [sent, setSent] = useState(false);
  const setOpen = (next) => {
    setOpenState(next);
    onOpenChange?.(next);
    // A sent message starts afresh next time; an unsent draft is kept.
    if (!next && sent) {
      setSent(false);
      setTopic(null);
    }
  };

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setOpen(!open)}
        whileTap={{ scale: 0.96 }}
        aria-expanded={open}
        aria-label={open ? undefined : 'Send a message'}
        // Closed: a 40 px round icon button, like the map controls. Open: the same "Close" pill as
        // About's (About steps out of the row meanwhile, so it sits in the same spot).
        className={`quiet-control message-button relative z-[60] flex cursor-pointer items-center justify-center rounded-full ${open ? 'h-11 px-5 text-sm' : 'size-10'}`}
        style={SANS_BOLD}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={open ? 'close' : 'message'}
            className="block"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            {open ? 'Close' : <MessageCircle size={18} strokeWidth={1.75} className="block" />}
          </motion.span>
        </AnimatePresence>
      </motion.button>

      <PanelOverlay open={open} onClose={() => setOpen(false)}>
        <motion.section
          custom={0}
          variants={panelVariants}
          initial="hidden"
          animate="shown"
          exit="exit"
          className={`${PANEL} flex flex-col gap-10 text-[var(--glass-fg)]`}
        >
          {sent ? (
            <motion.div {...REVEAL} className="mx-auto flex flex-col gap-4">
              <h2 className="text-[36px] leading-[1.4] sm:text-[52px]" style={SERIF}>
                <span style={{ fontWeight: 200 }}>YOU’RE </span>
                <em style={{ fontWeight: 200 }}>A</em> <span style={{ fontWeight: 800 }}>LEGEND</span>
              </h2>
              <div className="flex flex-col">
                <p className="flex h-10 items-center text-[15px] leading-[1.4] tracking-[0.15px]" style={SANS}>
                  Let’s chat more
                </p>
                <Contacts />
              </div>
            </motion.div>
          ) : (
            <>
              <h2 className="text-center text-[32px] leading-[1.4] sm:text-[52px]" style={SERIF}>
                <span style={{ fontWeight: 200 }}>What’s on your mind</span>
                <br />
                <span style={{ fontWeight: 800 }}>
                  <em>slope</em> dealer?
                </span>
              </h2>
              <div className="grid gap-4 sm:grid-cols-3 sm:gap-10" role="radiogroup" aria-label="What’s it about?">
                {TOPICS.map((t) => {
                  const selected = topic === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setTopic(t.id)}
                      className={`flex h-[66px] cursor-pointer flex-col items-center justify-center rounded-[14px] px-6 text-center text-[13px] leading-[1.4] tracking-[0.13px] transition-colors ${
                        selected
                          ? 'bg-[var(--quiet-bg)] text-[var(--quiet-fg)]'
                          : 'bg-[var(--glass-tint)] ring-1 ring-[var(--quiet-rim)] ring-inset hover:bg-[color-mix(in_srgb,var(--quiet-bg)_40%,transparent)]'
                      }`}
                      style={SANS}
                    >
                      <span>{t.label}</span>
                      {selected && <span className="italic opacity-65">{t.reply}</span>}
                    </button>
                  );
                })}
              </div>
              {topic === 'idea' && <IdeaPointers key="pointers" />}
              {topic === 'together' && (
                <motion.div {...REVEAL} key="together">
                  <Contacts />
                </motion.div>
              )}
              {FIELDS[topic] && <MessageForm key={topic} topic={topic} onSent={() => setSent(true)} />}
            </>
          )}
        </motion.section>
      </PanelOverlay>
    </>
  );
}
