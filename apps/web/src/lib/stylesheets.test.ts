import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

// A block left open (a lost "}" in a merge) doesn't break the build: the browser
// just ignores every rule after it, so whole parts of the page lose their styles.
describe('stylesheets', () => {
  for (const file of ['../styles.css', '../components/print-loader.css']) {
    it(`${file.replace('../', 'src/')} has every block closed`, () => {
      const css = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
      expect(() => postcss.parse(css, { from: file })).not.toThrow();
    });
  }
  it('catches a block left open', () => {
    expect(() => postcss.parse('.a { color: red;\n.b { color: blue; }')).toThrow(/Unclosed block/);
  });
});
