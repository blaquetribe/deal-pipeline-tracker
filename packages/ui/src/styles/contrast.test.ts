import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// WCAG AA for every text/surface pair both themes use. Translucent surfaces
// are composited over the canvas (the ambient gradient is ignored, which is
// why chrome keeps its glass fills light enough to pass on the flat canvas).
type Rgba = [number, number, number, number];

const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
const controlsCss = read('./controls.css');

function blocks(css: string) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector!.trim(),
    vars: Object.fromEntries(
      [...body!.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k!, v!.trim()]),
    ),
  }));
}

const primitives: Record<string, string> = Object.assign(
  {},
  ...blocks(read('./tokens.css')).map((b) => b.vars),
);
const themeBlocks = blocks(read('./themes.css'));
const light: Record<string, string> = Object.assign(
  {},
  ...themeBlocks.filter((b) => b.selector.includes(':root')).map((b) => b.vars),
);
const dark: Record<string, string> = {
  ...light,
  ...Object.assign(
    {},
    ...themeBlocks.filter((b) => b.selector.includes('.dark')).map((b) => b.vars),
  ),
};

function parse(value: string): Rgba {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h =
      hex[1]!.length === 3
        ? hex[1]!
            .split('')
            .map((c) => c + c)
            .join('')
        : hex[1]!;
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      1,
    ];
  }
  const rgb = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const [r, g, b, a = '1'] = rgb[1]!.split(/[\s,/]+/).filter(Boolean);
    return [Number(r), Number(g), Number(b), Number(a)];
  }
  throw new Error(`Not a colour: ${value}`);
}

function resolve(vars: Record<string, string>, name: string): Rgba {
  const value = vars[name] ?? primitives[name];
  if (!value) throw new Error(`Missing token --${name}`);
  const ref = value.match(/^var\(--([\w-]+)\)$/);
  return ref ? resolve(vars, ref[1]!) : parse(value);
}

const over = ([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba => [
  r * a + br * (1 - a),
  g * a + bg * (1 - a),
  b * a + bb * (1 - a),
  1,
];

const lin = (channel: number) => {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function luminance([r, g, b]: Rgba) {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgba, b: Rgba) {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const SURFACES = [
  'canvas',
  'surface',
  'surface-raised',
  'surface-subtle',
  'surface-hover',
  'glass-fill',
  'glass-fill-strong',
];
const TEXT = ['fg', 'fg-muted', 'fg-subtle', 'brand-fg', 'accent-fg'];
const STATUS_TEXT = ['success-fg', 'warning-fg', 'danger-fg', 'info-fg'];
// Toasts and banners put status text on glass chrome too.
const STATUS_SURFACES = ['canvas', 'surface', 'surface-raised', 'glass-fill', 'glass-fill-strong'];
// Tinted fills (active nav item, initials, banners, badges) carry their own
// -fg text. Each soft fill is composited over the surfaces it sits on.
const SOFT_TONES = ['brand', 'accent', 'success', 'warning', 'danger', 'info'];
const SOFT_BASES = ['canvas', 'glass-fill', 'glass-fill-strong', 'surface'];
const FILLS: [string, string][] = [
  ['fg-on-brand', 'brand'],
  ['fg-on-brand', 'brand-hover'],
  ['fg-on-accent', 'accent'],
  ['fg-on-accent', 'accent-hover'],
];

function pairs(): [string, string][] {
  return [
    ...TEXT.flatMap((t) => SURFACES.map((s): [string, string] => [t, s])),
    ...STATUS_TEXT.flatMap((t) => STATUS_SURFACES.map((s): [string, string] => [t, s])),
    ...FILLS,
  ];
}

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('%s theme contrast', (_name, vars) => {
  const canvas = resolve(vars, 'canvas');
  it('control borders meet 3:1 against their surfaces', () => {
    expect(
      contrast(resolve(vars, 'control-border'), resolve(vars, 'control-surface')),
    ).toBeGreaterThanOrEqual(3);
  });

  it('keeps disabled action labels readable on a neutral surface', () => {
    expect(controlsCss).toMatch(
      /button\[data-ui-button\]:disabled\s*\{[^}]*background:\s*var\(--surface-subtle\)[^}]*color:\s*var\(--fg-muted\)/s,
    );
    expect(
      contrast(resolve(vars, 'fg-muted'), resolve(vars, 'surface-subtle')),
    ).toBeGreaterThanOrEqual(4.5);
  });

  // Hover and subtle fills sit on a card; everything else sits on the canvas.
  const ON_SURFACE = new Set(['surface-subtle', 'surface-hover']);
  it.each(pairs())('%s on %s meets 4.5:1', (text, surface) => {
    const base = ON_SURFACE.has(surface) ? over(resolve(vars, 'surface'), canvas) : canvas;
    const bg = over(resolve(vars, surface), base);
    const fg = over(resolve(vars, text), bg);
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  const softPairs = SOFT_TONES.flatMap((tone) =>
    SOFT_BASES.map((base): [string, string, string] => [`${tone}-fg`, `${tone}-soft`, base]),
  );
  it.each(softPairs)('%s on %s over %s meets 4.5:1', (text, soft, surface) => {
    const base = over(resolve(vars, surface), canvas);
    const bg = over(resolve(vars, soft), base);
    const fg = over(resolve(vars, text), bg);
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
