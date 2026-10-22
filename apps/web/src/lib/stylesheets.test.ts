import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import loader from '../components/print-loader.css?raw';
import styles from '../styles.css?raw';

// A block left open (a lost "}" in a merge) doesn't break the build: the browser
// just ignores every rule after it, so whole parts of the page lose their styles.
describe('stylesheets', () => {
  for (const [file, css] of [
    ['src/styles.css', styles],
    ['src/components/print-loader.css', loader],
  ]) {
    it(`${file} has every block closed`, () => {
      expect(() => postcss.parse(css, { from: file })).not.toThrow();
    });
  }
  it('catches a block left open', () => {
    expect(() => postcss.parse('.a { color: red;\n.b { color: blue; }')).toThrow(/Unclosed block/);
  });
});
