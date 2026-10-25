# coherent-checks

`coherent-check` fails JavaScript and CSS that MSFS 2024's Coherent GT won't run or draw, before the sim sees it.
Coherent GT is the engine of the sim's cockpit panels, EFB, toolbar, in-game panels, and menu.
Its user agent says Chrome 49, but its features match no browser, so a page that works in a browser can break in the sim:

- A JavaScript file with one piece of syntax the engine can't parse, such as `?.`, runs none of its code.
- A missing built-in, such as `Array.prototype.at`, throws where it's called.
- A CSS declaration the engine can't read, such as `gap`, is dropped without an error, and a selector it can't read, such as `:focus-visible`, takes its whole rule with it.

The check knows what the engine does from measurements, not from a browser's compatibility table.
We built it for Dual Input, a shared cockpit for MSFS 2024, and publish it as it is, without support.

## Install

```bash
npm install --save-dev --save-exact github:dual-input/coherent-checks#v0.1.0
```

npm builds the package as it installs it, so the first install of each tag takes a little longer.
It needs Node 22.18 or later.

## Use

```bash
npx coherent-check dist/page.js dist/page.css
```

It checks a `.css` file as CSS and any other file as JavaScript, prints one line for each failure, and exits with 1 if it found any, or 2 if it was given no file:

```text
dist/page.css:12:3: gap is dropped by Coherent GT, in .toolbar
dist/page.js:40:18: .at is Array.prototype.at or String.prototype.at, missing in Coherent GT
  from src/page.ts:7:22
    const last = items.at(-1)
```

A JavaScript bundle with esbuild's source map beside it, `page.js.map`, gets a second line naming the source, and then that source's line.
A CSS failure names the rule it sits in, so a failure in Tailwind's output names the class.

From code:

```ts
import { checkFile, format } from "coherent-checks"

for (const finding of checkFile("dist/page.css")) console.log(format("dist/page.css", finding))
```

`checkJs(code, map?, mapDir?)` and `checkCss(code)` check text, and each `Finding` holds a `line`, a `column`, a `message`, and for JavaScript with a map, the `source`.

## What it checks

**JavaScript** parses at ECMAScript 2017, as the engine does, and fails:

- syntax from ES2018 on, such as object spread, `?.`, and class fields;
- each regex built by `new RegExp(...)` from strings with a feature from ES2018 on, as esbuild writes a regex it can't lower;
- each built-in and web API the engine lacks, such as `globalThis`, `Intl`, `ResizeObserver`, and `Promise.prototype.finally`, which the sim fills in only in some documents.

A local of the same name, a guard such as `typeof ResizeObserver !== "undefined"`, and the file's own fill-in pass.
Object rest fails too, though the engine runs it, since the check parses at ES2017.

**CSS** passes only what our probe measured the engine keeping, so CSS no probe has tried fails until one does:

| Part | Passes when |
| --- | --- |
| A property | the engine kept it, or kept its `-webkit-` form, or lists it as its own, such as `-webkit-font-smoothing`; a custom property always does |
| A keyword | anything but a keyword the engine dropped where Chromium kept it, such as `display: flow-root` |
| A function | the engine kept it in this property, or, in a property the probe never tried it in, kept it anywhere, so `circle()` passes in `-webkit-clip-path` and fails in `clip-path` |
| `rgb()`, `rgba()`, `hsl()`, `hsla()` | written with commas, with no `/`, no alpha as a percent, and no unit on the hue |
| A unit, a selector's part, an at-rule, a media feature | the engine kept it, and every selector or query inside one passes too |

It also fails what the engine parses and then ignores: `column-gap`, `justify-content: end`, `display: contents`, and the media queries `(hover: hover)` and `(pointer: fine)` and their `any-` forms, which never match in the sim, though `:hover` works.
A custom property's value gets the function, unit, and color checks, since it breaks wherever a `var()` puts it, as Tailwind 3's `--tw-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1)` does.
A declaration the engine drops passes beside a kept declaration of the same property or of its `-webkit-` twin, as autoprefixer writes `-webkit-user-select` beside `user-select`.
A `-moz-` or `-ms-` declaration passes, since only another engine reads it, but a `-moz-` selector fails, since one unreadable selector drops its whole rule.

## Where the measurements come from

Dual Input's probes ran in MSFS 2024 through the sim's inspector:

- **p09**, on MSFS 2024 SunRise 12.2.282174.999 on 2026-10-09, ran JavaScript syntax samples and asked for each built-in and web API in five documents: mainUi, the EFB's, the toolbar's, a cockpit panel, and an in-game panel.
  `data/js.json` lists what it found missing, and what the sim fills in only in some of them.
- **p13**, on MSFS 2024, Steam build 26058316, on 2026-10-25, ran 129 tests in mainUi, the EFB's document, and the toolbar's, laying out elements under rules of its own and reading back their computed style.
- **p14**, on the same build and day, in the same three documents, tried every property with up to 40 of the keywords its syntax names, and every function, unit, selector, and at-rule that MDN's mdn-data 2.37.2 lists, with media features listed by hand, and ran the same tests in Chromium 152.

Every p13 and p14 item gave the same answer in all three documents.
`data/css.json` is p14's answers, which `npm run css-data` writes from p14's results in `measurements/`, and which nobody edits by hand.
`data/css-rules.json` holds what those answers can't say, each entry with how we know: what p13 measured that p14 didn't try, and what the engine parses and then ignores.
The tests check the CSS check against every p14 item either engine kept and every p13 case, and the JavaScript check against p09's samples.

## After a sim update

A sim update can change any of this.

1. In Dual Input, run p09 with the sim in a flight, and p14 with the sim at the main menu, after its `--baseline` run in current Chromium.
2. Change `data/js.json` to what p09 found.
3. Copy p14's two results files into `measurements/`.
4. Run `npm run css-data`, which reads the newest of each.
5. Run `npm test`.
   A failure names each item where the check and the engine now disagree.
6. Commit, and tag a new version.

## Known gaps

- A regex built from a pattern computed at run time escapes the JavaScript check, since a parse can't see it.
- CSS written in markup, such as a `style` attribute or a `<style>` element in an HTML file, isn't checked; only `.css` files are.
- A keyword p14 never tried passes, since p14 tried at most 40 per property and none for the engine's own properties, such as `-webkit-box-orient`.
- Kept means the engine holds a declaration, and lays out boxes where Chromium does where p13 or p14 measured a layout; neither probe looked at the paint, which only a screenshot shows.
- No probe has measured the CSS of an in-game panel's document.

## Develop

```bash
npm install
```

```bash
npm test
```

`npm test` type-checks the sources, tests, and scripts, then runs the tests.
Node runs the TypeScript in `src/`, `test/`, and `scripts/` as it is, and npm's `prepare` compiles `src/` into `dist/` for the installed copy, since Node won't run TypeScript from `node_modules`.
