import postcss, { type Declaration, type Root } from 'postcss';
import { describe, expect, it } from 'vitest';
import { PHONE_MAX } from './breakpoints';

// Every stylesheet the page loads: src/styles/*.css (index.css imports them in
// cascade order) and the print loader's own file.
const FILES = {
  ...import.meta.glob<string>('../styles/*.css', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>('../components/*.css', { query: '?raw', import: 'default', eager: true }),
};
// Code that sets custom properties of its own (style={{ '--aspect': … }}).
const CODE = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.ts'], { query: '?raw', import: 'default', eager: true });

const name = (path: string) => path.replace(/^\.\.\//, 'src/');
const roots: [string, Root][] = Object.entries(FILES).map(([path, css]) => [name(path), postcss.parse(css, { from: name(path) })]);

/** Every declaration outside the token definitions, with where it is. */
function declarations(): { file: string; decl: Declaration }[] {
  const out: { file: string; decl: Declaration }[] = [];
  for (const [file, root] of roots) root.walkDecls((decl) => void (decl.prop.startsWith('--') || out.push({ file, decl })));
  return out;
}
const where = ({ file, decl }: { file: string; decl: Declaration }) => `${file}:${decl.source?.start?.line} ${decl.prop}: ${decl.value}`;

// A block left open (a lost "}" in a merge) doesn't break the build: the browser
// just ignores every rule after it, so whole parts of the page lose their styles.
describe('stylesheets', () => {
  it('finds the stylesheets', () => {
    expect(Object.keys(FILES).length).toBeGreaterThan(10);
  });
  for (const [path, css] of Object.entries(FILES)) {
    it(`${name(path)} has every block closed`, () => {
      expect(() => postcss.parse(css, { from: path })).not.toThrow();
    });
  }
  it('catches a block left open', () => {
    expect(() => postcss.parse('.a { color: red;\n.b { color: blue; }')).toThrow(/Unclosed block/);
  });
  it('index.css imports every file in src/styles', () => {
    const index = FILES['../styles/index.css'];
    const imported = [...index.matchAll(/@import '\.\/([\w-]+\.css)';/g)].map((m) => m[1]);
    const files = Object.keys(FILES)
      .filter((p) => p.startsWith('../styles/') && !p.endsWith('/index.css'))
      .map((p) => p.replace('../styles/', ''));
    expect(imported[0]).toBe('tokens.css');
    expect([...imported].sort()).toEqual(files.sort());
  });
});

// The design system (docs/architecture/design-system.md): values come from src/styles/tokens.css.
describe('design tokens', () => {
  const decls = declarations();

  it('no colour is typed outside the tokens', () => {
    const colour = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|oklch|oklab|lab|lch)\(|\b(white|black)\b/i;
    expect(decls.filter((d) => colour.test(d.decl.value)).map(where)).toEqual([]);
  });

  it('text sizes come from the type scale', () => {
    const ok = /^(var\(--t-(xs|sm|md|lg|xl|2xl)\)|0|inherit)$/;
    expect(decls.filter((d) => d.decl.prop === 'font-size' && !ok.test(d.decl.value)).map(where)).toEqual([]);
    const font = /^(var\(--t-(xs|sm|md|lg|xl|2xl)\)\/[\d.]+ var\(--font-(sans|mono)\)|inherit)$/;
    expect(decls.filter((d) => d.decl.prop === 'font' && !font.test(d.decl.value)).map(where)).toEqual([]);
    expect(decls.filter((d) => d.decl.prop === 'font-family' && !/^(var\(--font-(sans|mono)\)|inherit)$/.test(d.decl.value)).map(where)).toEqual([]);
  });

  it('two weights: normal and bold', () => {
    expect(decls.filter((d) => d.decl.prop === 'font-weight' && !/^(400|600|inherit)$/.test(d.decl.value)).map(where)).toEqual([]);
  });

  it('corners come from the corner tokens', () => {
    const one = /^(var\(--r-(sm|md|lg|xl|full)\)|0|50%|inherit)$/;
    const bad = decls.filter((d) => /radius$/.test(d.decl.prop) && !d.decl.value.split(/\s+/).every((v) => one.test(v)));
    expect(bad.map(where)).toEqual([]);
  });

  it('layers above 10 come from the layer tokens', () => {
    const bad = decls.filter((d) => d.decl.prop === 'z-index' && !/^var\(--z-(notice|menu|context)\)$/.test(d.decl.value) && !(Number(d.decl.value) <= 10));
    expect(bad.map(where)).toEqual([]);
  });

  it('one phone width (and one narrow-phone and tablet step)', () => {
    const allowed = new Set([`max-width: ${PHONE_MAX}px`, `min-width: ${PHONE_MAX + 1}px`, 'max-width: 420px', 'max-width: 1099px', 'min-width: 1100px', 'max-width: 1279px', 'min-width: 1280px']);
    const bad: string[] = [];
    for (const [file, root] of roots)
      root.walkAtRules('media', (rule) => {
        for (const m of rule.params.matchAll(/\((m(?:in|ax)-width: *[\d.]+px)\)/g)) if (!allowed.has(m[1].replace(/: */, ': '))) bad.push(`${file}:${rule.source?.start?.line} @media ${rule.params}`);
      });
    expect(bad).toEqual([]);
  });

  it('every var() without a fallback is defined somewhere', () => {
    const defined = new Set<string>();
    for (const [, root] of roots) root.walkDecls((d) => void (d.prop.startsWith('--') && defined.add(d.prop)));
    for (const code of Object.values(CODE)) for (const m of code.matchAll(/'(--[\w-]+)'/g)) defined.add(m[1]);
    const missing: string[] = [];
    for (const [file, root] of roots)
      root.walkDecls((d) => {
        for (const m of d.value.matchAll(/var\((--[\w-]+)\)/g)) if (!defined.has(m[1])) missing.push(`${file}:${d.source?.start?.line} ${m[1]}`);
      });
    expect(missing).toEqual([]);
  });

  // Spacing off the 2/4/6/8/12/16/24/32 steps is still common in older rules.
  // Each design-system PR moves its parts onto the steps; this count may only
  // go down (lower it when a change brings it down).
  it('spacing off the steps does not grow', () => {
    const steps = new Set([0, 1, 2, 4, 6, 8, 12, 16, 24, 32]);
    let off = 0;
    for (const { decl } of decls) {
      if (!/^(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/.test(decl.prop)) continue;
      for (const m of decl.value.matchAll(/(-?[\d.]+)px/g)) {
        const v = Math.abs(Number(m[1]));
        if (v <= 32 && !steps.has(v)) off++;
      }
    }
    expect(off).toBeLessThanOrEqual(OFF_STEP_SPACING);
  });
});

const OFF_STEP_SPACING = 186;
