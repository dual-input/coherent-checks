import assert from "node:assert/strict"
import { test } from "node:test"

import { readP14 } from "../scripts/p14.ts"
import { checkCss } from "../src/index.ts"

const messages = (css: string) => checkCss(css).map((f) => f.message)
const fails = (css: string) => checkCss(css).length > 0

// What the engine keeps and then ignores, which the check fails though p14 saw it kept
// (data/css-rules.json, "ignored"), and `column-gap: normal`, which spaces nothing anywhere
// and fails with every other column-gap.
const FAILED_THOUGH_KEPT = new Set([
  "property column-gap",
  "keyword column-gap: normal",
  "keyword justify-content: end",
  "keyword display: contents",
  "media (hover: hover)",
  "media (any-hover: hover)",
  "media (pointer: fine)",
  "media (any-pointer: fine)",
])

test("the check passes every item p14 saw Coherent GT keep, and fails every one it saw dropped where Chromium kept it", () => {
  const wrong: string[] = []
  let checked = 0
  for (const item of readP14().items) {
    // A sample neither engine kept says nothing of Coherent GT.
    if (!item.kept && !item.chromium) continue
    checked++
    const failed = fails(item.css)
    const expected = !item.kept || FAILED_THOUGH_KEPT.has(`${item.group} ${item.name}`)
    if (failed !== expected) wrong.push(`${item.group} ${item.name}: the engine ${item.kept ? "kept" : "dropped"} it, and the check ${failed ? "failed" : "passed"} ${item.css}`)
  }
  assert.deepEqual(wrong, [])
  assert.ok(checked > 2500, `the check met only ${checked} of p14's items`)
})

// p13's cases, each with whether it drew in MSFS 2024's mainUi, the EFB's document, and the
// toolbar's on 2026-10-25, by its own measurement of the layout or the computed style (Dual
// Input, record/areas/architecture/log.md, "2026-10-25: Coherent GT drops `@layer`, oklch,
// `color-mix()`, and every `gap` but `grid-gap`, so Tailwind 4's output can't style a page
// there"; read in experiments/areas/architecture/p13-coherent-css.mjs and its results of
// 08:35:47). It leaves out its `vw` case, which failed on rounding, and `outline-offset`
// with no outline, which computes as 0px in every engine.
const BOX = "#h .p>div{width:10px;height:10px}"
const P13: [string, string, boolean][] = [
  ["flex", `#h .p{display:flex;width:100px} ${BOX}`, true],
  ["flex gap", `#h .p{display:flex;gap:6px;width:100px} ${BOX}`, false],
  ["flex: 1", "#h .p{display:flex;width:100px} #h .a{width:20px;height:5px} #h .b{flex:1;height:5px}", true],
  ["inline-flex", "#h .a{display:inline-flex}", true],
  ["grid columns", "#h .p{display:grid;grid-template-columns:10px 20px;width:100px} #h .p>div{height:5px}", true],
  ["grid gap", "#h .p{display:grid;grid-template-columns:10px 20px;gap:4px;width:100px} #h .p>div{height:5px}", false],
  ["grid-gap", "#h .p{display:grid;grid-template-columns:10px 20px;grid-gap:4px;width:100px} #h .p>div{height:5px}", true],
  ["grid-column-gap", "#h .p{display:grid;grid-template-columns:10px 20px;grid-column-gap:4px;width:100px} #h .p>div{height:5px}", true],
  ["column-gap in a grid", "#h .p{display:grid;grid-template-columns:10px 20px;column-gap:4px;width:100px} #h .p>div{height:5px}", false],
  ["column-gap in a flex row", `#h .p{display:flex;column-gap:6px;width:100px} ${BOX}`, false],
  ["position: -webkit-sticky", "#h .a{position:-webkit-sticky;top:0}", true],
  ["grid repeat(2, minmax(0, 1fr))", "#h .p{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100px} #h .p>div{height:5px}", true],
  ["grid place-items: center", "#h .p{display:grid;place-items:center;width:100px;height:100px} #h .a{width:10px;height:10px}", true],
  ["aspect-ratio", "#h .a{width:40px;aspect-ratio:2/1}", false],
  ["inset", "#h .p{position:relative;width:100px;height:100px} #h .a{position:absolute;inset:5px}", false],
  ["position: sticky", "#h .a{position:sticky;top:0}", false],
  ["margin-inline-start", "#h .a{margin-inline-start:7px;width:5px;height:5px}", false],
  ["padding-inline", "#h .a{width:10px;height:1px;padding-inline:5px}", false],
  ["padding-block", "#h .a{height:0;padding-block:3px}", false],
  ["box-sizing: border-box", "#h .a{box-sizing:border-box;width:20px;padding:5px}", true],
  ["display: contents", "#h .a{display:contents}", false],
  ["display: flow-root", "#h .a{display:flow-root}", false],
  ["calc()", "#h .a{width:calc(10px + 5px)}", true],
  ["min()", "#h .a{width:min(10px, 20px)}", false],
  ["max()", "#h .a{width:max(10px, 20px)}", false],
  ["clamp()", "#h .a{width:clamp(5px, 50px, 12px)}", false],
  ["rem", "#h .a{width:1rem}", true],
  ["em", "#h .a{font-size:10px;width:2em}", true],
  ["dvh", "#h .a{height:10dvh}", false],
  ["container query units", "#h .p{container-type:inline-size;width:200px} #h .a{width:10cqw;height:1px}", false],
  ["var()", "#h .a{--w:13px;width:var(--w)}", true],
  ["var() fallback", "#h .a{width:var(--nope, 9px)}", true],
  ["var() inherited", "#h{--rw:11px} #h .a{width:var(--rw)}", true],
  ["calc(var() * 4)", "#h .a{--s:4px;width:calc(var(--s) * 4)}", true],
  ["@property", "@property --p13{syntax:'<length>';inherits:false;initial-value:11px} #h .a{width:var(--p13)}", false],
  ["@layer", "@layer x{#h .a{width:5px}}", false],
  ["@layer order", "@layer x, y; @layer y{#h .a{width:6px}} @layer x{#h .a{width:5px}}", false],
  ["@supports", "@supports (display:grid){#h .a{width:3px}}", true],
  ["@media (min-width)", "@media (min-width:1px){#h .a{width:8px}}", true],
  ["@media range syntax", "@media (width >= 1px){#h .a{width:8px}}", false],
  ["@container", "#h .p{container-type:inline-size;width:200px} @container (min-width: 150px){#h .a{width:7px}}", false],
  ["@keyframes and animation", "@keyframes p13{from{opacity:0}to{opacity:1}} #h .a{animation:p13 1s}", true],
  ["nesting with &", "#h .p{& .a{width:8px}}", false],
  ["nesting without &", "#h .p{.a{width:9px}}", false],
  [":is()", "#h :is(.p) .a{width:4px}", false],
  [":where()", "#h :where(.p) .a{width:4px}", false],
  [":not() with a list", "#h .a:not(.x, .y){width:4px}", true],
  [":has()", "#h .p:has(.a){width:50px}", false],
  [":focus-visible", "#h .a:focus-visible, #h .a{width:4px}", false],
  [":focus-within", "#h .a:focus-within, #h .a{width:4px}", true],
  ["::placeholder", "#h input::placeholder, #h .a{width:4px}", true],
  ["::-webkit-scrollbar", "#h .a::-webkit-scrollbar, #h .a{width:4px}", true],
  ["::selection", "#h .a::selection, #h .a{width:4px}", true],
  ["::marker", "#h .a::marker, #h .a{width:4px}", false],
  ["[data-state=open]", "#h [data-state=open]{width:4px}", true],
  ["::before with content", "#h .a{display:inline-block} #h .a::before{content:'';display:block;width:6px;height:6px}", true],
  ...(
    [
      ["#4fd3ea", true],
      ["#4fd3ea80", true],
      ["rgb(79, 211, 234)", true],
      ["rgb(79 211 234)", false],
      ["rgb(79 211 234 / 50%)", false],
      ["rgba(79, 211, 234, 0.5)", true],
      ["hsl(189, 79%, 61%)", true],
      ["hsl(189 79% 61%)", false],
      ["hwb(189 30% 8%)", false],
      ["oklch(0.8 0.12 210)", false],
      ["oklch(80% 0.12 210 / 0.5)", false],
      ["lab(78 -30 -20)", false],
      ["color(display-p3 0.3 0.8 0.9)", true],
      ["color-mix(in srgb, red 50%, blue)", false],
      ["color-mix(in oklab, red 50%, blue)", false],
      ["color-mix(in oklab, red 50%, transparent)", false],
      ["rgb(from red r g b / 50%)", false],
      ["light-dark(white, black)", false],
      ["currentColor", true],
    ] as const
  ).map(([color, drew]): [string, string, boolean] => [color, `#h .c{color:rgb(9, 9, 9)} #h .c.v{color:${color}}`, drew]),
  ["rgba(var() holding a triplet, 0.5)", "#h .c{color:rgb(9, 9, 9)} #h .c.v{--t:1, 2, 3;color:rgba(var(--t), 0.5)}", true],
  ["var() holding a color", "#h .c{color:rgb(9, 9, 9)} #h .c.v{--k:rgb(1, 2, 3);color:var(--k)}", true],
  ...(
    [
      ["opacity", "50%", false],
      ["opacity", "0.5", true],
      ["filter", "drop-shadow(0 1px 2px black)", true],
      ["border-radius", "8px", true],
      ["box-shadow", "0 1px 2px rgba(0,0,0,0.5), inset 0 0 1px red", true],
      ["filter", "blur(4px)", true],
      ["backdrop-filter", "blur(4px)", false],
      ["-webkit-backdrop-filter", "blur(4px)", false],
      ["mix-blend-mode", "multiply", true],
      ["clip-path", "inset(2px)", false],
      ["mask-image", "linear-gradient(black, transparent)", false],
      ["-webkit-mask-image", "linear-gradient(black, transparent)", true],
      ["background-image", "linear-gradient(red, blue)", true],
      ["background-image", "radial-gradient(red, blue)", true],
      ["background-image", "conic-gradient(red, blue)", false],
      ["background-clip", "text", false],
      ["-webkit-background-clip", "text", true],
      ["transition", "opacity 150ms ease", true],
      ["will-change", "transform", true],
      ["contain", "layout", false],
      ["font-variant-numeric", "tabular-nums", true],
      ["font-feature-settings", '"tnum"', true],
      ["text-wrap", "balance", false],
      ["letter-spacing", "0.1em", true],
      ["text-overflow", "ellipsis", true],
      ["-webkit-line-clamp", "2", true],
      ["line-clamp", "2", false],
      ["text-underline-offset", "3px", false],
      ["text-decoration-thickness", "2px", false],
      ["overflow-wrap", "anywhere", false],
      ["hyphens", "auto", false],
      ["accent-color", "red", false],
      ["appearance", "none", false],
      ["-webkit-appearance", "none", true],
      ["field-sizing", "content", false],
      ["caret-color", "red", false],
      ["user-select", "none", false],
      ["-webkit-user-select", "none", true],
      ["cursor", "pointer", true],
      ["scrollbar-width", "thin", false],
      ["scrollbar-gutter", "stable", false],
      ["overscroll-behavior", "contain", false],
      ["touch-action", "none", false],
      ["color-scheme", "dark", false],
      ["object-fit", "cover", true],
    ] as const
  ).map(([property, value, drew]): [string, string, boolean] => [`${property}: ${value}`, `#h .a{${property}:${value}}`, drew]),
  ["outline-offset under a solid outline", "#h .a{outline:1px solid red;outline-offset:2px}", true],
  ["transform: translateX()", "#h .a{width:5px;height:5px;transform:translateX(10px)}", true],
  ["translate property", "#h .a{width:5px;height:5px;translate:10px 0}", false],
  ["scale property", "#h .a{width:10px;height:10px;scale:2}", false],
  ["rotate property", "#h .a{width:10px;height:20px;rotate:90deg}", false],
  ...(
    [
      ["(prefers-color-scheme: dark)", false],
      ["(prefers-color-scheme: light)", false],
      ["(prefers-reduced-motion: reduce)", true],
      ["(hover: hover)", false],
      ["(pointer: fine)", false],
      ["(min-width: 1px)", true],
      ["(width >= 1px)", false],
      ["(min-resolution: 1dppx)", false],
      ["(forced-colors: active)", false],
    ] as const
  ).map(([query, read]): [string, string, boolean] => [`@media ${query}`, `@media ${query}{#h .a{width:8px}}`, read]),
]

test("the check passes every p13 case that drew in Coherent GT, and fails every one that didn't", () => {
  const wrong = P13.filter(([, css, drew]) => fails(css) === drew).map(([name, css, drew]) => `${name}: ${drew ? "drew" : "didn't draw"}, and the check ${drew ? "failed" : "passed"} ${css}: ${messages(css).join("; ")}`)
  assert.deepEqual(wrong, [])
})

test("each finding names its line, its column, and the rule it sits in", () => {
  const [f, ...rest] = checkCss(".a { color: red }\n.gap-2 {\n  gap: 0.5rem;\n}\n")
  assert.equal(rest.length, 0)
  assert.deepEqual([f!.line, f!.column], [3, 3])
  assert.equal(f!.message, "gap is dropped by Coherent GT, in .gap-2")
})

test("a dropped declaration passes beside a kept one of the same property or its -webkit- twin", () => {
  assert.deepEqual(messages(".a { -webkit-user-select: none; user-select: none }"), [])
  assert.deepEqual(messages(".a { width: 10px; width: min(10px, 50%) }"), [])
  assert.deepEqual(messages(".a { user-select: none }"), ["user-select is dropped by Coherent GT, in .a"])
  // What the engine keeps and then ignores is no twin's to cover.
  assert.deepEqual(messages(".a { display: block; display: contents }"), ["display: contents parses in Coherent GT and then computes as inline, in .a"])
})

test("a custom property's value fails where a var() would break whatever it goes into", () => {
  assert.deepEqual(messages(".shadow { --tw-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1) }"), [
    "rgb() with a slash is dropped by Coherent GT, so --tw-shadow breaks wherever var() puts it, in .shadow",
  ])
  assert.deepEqual(messages(".a { --primary: 116, 212, 255; color: rgba(var(--primary), 0.8) }"), [])
  assert.deepEqual(messages(".a { --pan: pan-left }"), [])
})

test("a selector Coherent GT can't read fails its whole rule, read one by one where css-tree can't read the list", () => {
  assert.deepEqual(messages(".a:focus-visible { color: red }"), [":focus-visible is dropped by Coherent GT, which drops the whole rule, in .a:focus-visible"])
  assert.deepEqual(messages(".a, .b || .c { color: red }"), [
    'the check can\'t read the selector ".b || .c", so it fails until a probe measures it, in .a, .b || .c',
  ])
  assert.deepEqual(messages(".a:before, .b::after, .c:nth-child(2 of .d) { content: '' }"), [])
  assert.deepEqual(messages(".a:-moz-focusring { color: red }")[0], ":-moz-focusring is untested in Coherent GT, so count on it nowhere until a probe measures it, which drops the whole rule, in .a:-moz-focusring")
})

test("a function passes in a property p14 never tried it in where p14 kept it elsewhere, and fails where p14 saw it dropped", () => {
  assert.deepEqual(messages(".a { -webkit-clip-path: circle(50%) }"), [])
  assert.deepEqual(messages(".a { clip-path: circle(50%) }"), ["circle() in clip-path is dropped by Coherent GT, in .a"])
  assert.deepEqual(messages(".a { transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1) }"), [])
  assert.deepEqual(messages(".a { height: min(10px, 50%) }"), ["min() is dropped by Coherent GT, in .a"])
})

test("a media feature's min- and max- forms are one feature, and an at-rule the engine drops takes its rules with it", () => {
  assert.deepEqual(messages("@media (max-height: 400px) { .a { color: red } }"), [])
  assert.deepEqual(messages("@media (min-resolution: 2dppx) { .a { color: red } }")[0], "(min-resolution) in a media query is dropped by Coherent GT, so no rule under this query applies")
  assert.deepEqual(messages("@media (prefers-color-scheme: dark), print { .a { gap: 1px } }"), [
    "(prefers-color-scheme) in a media query is dropped by Coherent GT, so no rule under this query applies",
    "gap is dropped by Coherent GT, in .a",
  ])
  assert.deepEqual(messages("@layer base { .a { gap: 1px } }"), ["@layer is dropped by Coherent GT, with every rule inside it"])
  assert.deepEqual(messages('@import url("a.css") layer(base);'), ["@import layer() is dropped by Coherent GT, with every rule inside it"])
})

test("other engines' declarations, keyframes' selectors, and a font face's descriptors pass", () => {
  assert.deepEqual(messages(".a { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale }"), [])
  assert.deepEqual(messages("@keyframes spin { from { transform: rotate(0deg) } 50% { opacity: .5 } to { transform: rotate(360deg) } }"), [])
  assert.deepEqual(messages('@font-face { font-family: Geist; src: url(Geist.ttf) format("truetype"); font-display: swap }'), [])
  assert.deepEqual(messages("@keyframes k { from { gap: 1px } }"), ["gap is dropped by Coherent GT, in from"])
})
