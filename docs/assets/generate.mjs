// Generates the README header and section-divider SVGs (light + dark variants).
// Run: node docs/assets/generate.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));

const SECTIONS = [
  ['overview', 'OVERVIEW'],
  ['stack', 'STACK'],
  ['quick-start', 'QUICK START'],
  ['try-it', 'TRY IT'],
  ['architecture', 'ARCHITECTURE'],
  ['testing', 'TESTING'],
  ['limitations', 'LIMITATIONS'],
  ['roadmap', 'ROADMAP'],
];

const FOCUS = [
  'claim races → exactly one owner',
  'stale edits → 409, never a lost update',
  'retries → replayed, never applied twice',
  'outbox · skip locked · listen/notify',
];

const THEMES = {
  light: { ink: '#000000', muted: '#57606a' },
  dark: { ink: '#ffffff', muted: '#8b949e' },
};

const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

// Monoline digit glyphs in a 44×90 box; drawn on with a dash animation.
const DIGITS = {
  0: ['<ellipse cx="22" cy="45" rx="19" ry="42"/>', '<path d="M34,16 L10,74"/>'],
  1: ['<path d="M8,19 L26,4 L26,86"/>'],
  2: ['<path d="M4,22 C4,9 12,3 22,3 C33,3 40,10 40,22 C40,40 4,60 4,86 L42,86"/>'],
  3: ['<path d="M5,12 C9,6 15,3 22,3 C33,3 40,10 40,22 C40,34 32,42 20,42 C34,42 42,51 42,64 C42,78 33,87 22,87 C14,87 8,84 4,78"/>'],
  4: ['<path d="M32,86 L32,4 L3,62 L44,62"/>'],
  5: ['<path d="M40,4 L9,4 L6,41 C11,37 17,35 23,35 C35,35 42,45 42,59 C42,75 33,87 21,87 C13,87 7,84 3,78"/>'],
  6: ['<path d="M37,9 C33,5 28,3 23,3 C10,3 3,21 3,49 C3,73 11,87 23,87 C35,87 42,77 42,63 C42,49 35,39 23,39 C14,39 7,45 3,53"/>'],
  7: ['<path d="M3,4 L42,4 L16,86"/>'],
  8: ['<ellipse cx="22" cy="22" rx="16" ry="19"/>', '<ellipse cx="22" cy="64" rx="19" ry="23"/>'],
  9: ['<path d="M7,81 C11,85 16,87 21,87 C34,87 41,69 41,41 C41,17 33,3 21,3 C9,3 2,13 2,27 C2,41 9,51 21,51 C30,51 37,45 41,37"/>'],
};

const STYLE = `
    .mono { font-family: ${MONO}; }
    .dash { stroke-dasharray: 1; stroke-dashoffset: 1; animation: dash 1.15s cubic-bezier(.6,0,.2,1) forwards; }
    @keyframes dash { to { stroke-dashoffset: 0; } }
    .f { opacity: 0; animation: f .8s ease forwards; }
    @keyframes f { to { opacity: 1; } }
    .rise { opacity: 0; animation: rise .9s cubic-bezier(.2,.7,.2,1) forwards; }
    @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    .d1 { animation-delay: .05s } .d3 { animation-delay: .45s } .d4 { animation-delay: .7s } .d5 { animation-delay: .95s }
    .g1 .dash { animation-delay: .06s } .g2 .dash { animation-delay: .24s }
    .rule { animation-duration: 1.3s; animation-delay: .55s }`;

const REDUCED = (extra = '') => `
    @media (prefers-reduced-motion: reduce) {
      .dash, .f, .rise${extra ? ', .rot' : ''} { animation: none; }
      .dash { stroke-dashoffset: 0; }
      .f, .rise { opacity: 1; transform: none; }${extra}
    }`;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Stroked digits (with pathLength=1 so one dasharray fits every glyph). */
function glyphs(n, ink) {
  const [a, b] = String(n).padStart(2, '0');
  const draw = (d) => DIGITS[d].map((s) => s.replace(/^<(\w+)/, '<$1 class="dash" pathLength="1"')).join('');
  return `<g fill="none" stroke="${ink}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round">` +
    `<g class="g1" transform="translate(45,46)">${draw(a)}</g><g class="g2" transform="translate(101,46)">${draw(b)}</g></g>`;
}

function section(index, slug, title, { ink, muted }) {
  const num = String(index).padStart(2, '0');
  const path = `~/${num}-${slug}`;
  const ruleStart = 190 + title.length * 29 + 8;
  const ruleEnd = 1556 - path.length * 12.4 - 44;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 180" width="1600" height="180" fill="none" role="img" aria-label="Section ${num} — ${title}">
  <style>${STYLE}${REDUCED()}
  </style>
  ${glyphs(index, ink)}
  <text class="mono rise d3" x="190" y="98" font-size="21" letter-spacing="7.5" fill="${ink}">${esc(title)}</text>
  <line class="dash rule" pathLength="1" x1="${ruleStart}" y1="90" x2="${ruleEnd.toFixed(0)}" y2="90" stroke="${ink}" stroke-width="1.5" opacity="0.45"/>
  <text class="mono f d5" x="1556" y="96" text-anchor="end" font-size="17" letter-spacing="2" fill="${muted}">${esc(path)}</text>
</svg>
`;
}

function header({ ink, muted }) {
  const slot = 12 / FOCUS.length;
  const rotation = FOCUS.map((_, i) => `.r${i + 1} { animation-delay: ${(1.1 + i * slot).toFixed(1)}s }`).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 320" width="1600" height="320" fill="none" role="img" aria-label="OPSDESK — operational work, coordinated under pressure">
  <style>${STYLE}
    .rot { opacity: 0; animation: rot 12s linear infinite; }
    @keyframes rot { 0% {opacity:0} 2% {opacity:1} 21% {opacity:1} 25% {opacity:0} 100% {opacity:0} }
    ${rotation}${REDUCED('\n      .rot { opacity: 0; } .rot.r1 { opacity: .85; }')}
  </style>
  <line class="dash" pathLength="1" x1="46" y1="92" x2="1554" y2="92" stroke="${ink}" stroke-width="1" opacity="0.28"/>
  <g class="f d1">
    <text class="mono" x="46" y="72" font-size="16" letter-spacing="2.5" fill="${muted}">~/newtonite/opsdesk</text>
    <text class="mono" x="1554" y="72" text-anchor="end" font-size="16" letter-spacing="2.5" fill="${muted}">v1 · operations under pressure</text>
  </g>
  <g class="rise d3">
    <text class="mono" x="44" y="186" font-size="72" font-weight="300" letter-spacing="11" fill="${ink}">OPSDESK</text>
  </g>
  <g class="f d4">
    <text class="mono" x="48" y="230" font-size="19" letter-spacing="4" fill="${muted}">operational work tracker &#183; claim &#183; approve &#183; resolve</text>
  </g>
  <g class="f d5">
    <text class="mono" x="48" y="272" font-size="14" letter-spacing="1.5" fill="${muted}">guarantee &#9656;</text>
  </g>
${FOCUS.map((t, i) => `  <text class="mono rot r${i + 1}" x="168" y="272" font-size="15" letter-spacing="2" fill="${ink}" opacity="0.85">${esc(t)}</text>`).join('\n')}
  <line class="dash rule" pathLength="1" x1="46" y1="300" x2="1554" y2="300" stroke="${ink}" stroke-width="1.5" opacity="0.28" style="animation-delay:.75s;animation-duration:1.4s"/>
</svg>
`;
}

for (const [theme, colors] of Object.entries(THEMES)) {
  const dir = theme === 'light' ? OUT : join(OUT, 'dark');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'header.svg'), header(colors));
  SECTIONS.forEach(([slug, title], i) => writeFileSync(join(dir, `s${String(i + 1).padStart(2, '0')}.svg`), section(i + 1, slug, title, colors)));
}
console.log(`wrote header + ${SECTIONS.length} sections × ${Object.keys(THEMES).length} themes to ${OUT}`);
