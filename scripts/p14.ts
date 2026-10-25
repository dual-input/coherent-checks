// Reads Dual Input's probe p14, which tried each CSS property, keyword, function, unit,
// selector, at-rule, and media query mdn-data lists in MSFS 2024's Coherent GT and in
// Chromium, as one item each: the stylesheet that tests it, and whether each engine kept it.
// scripts/css-data.ts writes data/css.json from these items, and test/css.test.ts checks
// the check against them, so both read p14's answers the same way.
//
// p14 saves each answer as what the engine's CSSOM gave back, and its at-rules' text only
// in its own source, which measurements/p14-at-rules.json copies (Dual Input,
// experiments/areas/architecture/p14-coherent-css-full.mjs).

import fs from "node:fs"
import path from "node:path"

import * as csstree from "css-tree"

export const MEASUREMENTS = path.join(import.meta.dirname, "..", "measurements")

export type Group = "property" | "webkit" | "keyword" | "function" | "value" | "unit" | "selector" | "atRule" | "media"

export type Item = {
  group: Group
  /** What p14 tried, such as `gap`, `display: contents`, or `.x:focus-visible`. */
  name: string
  /** A stylesheet holding it alone, as p14 tried it. */
  css: string
  /** For a property's keyword, a function, and a value, the property it's in, and the value. */
  property?: string
  value?: string
  /** Whether Coherent GT kept it in every document p14 ran in, and whether Chromium kept it. */
  kept: boolean
  chromium: boolean
}

export type P14 = {
  file: string
  mdnData: string
  documents: string[]
  userAgent: string
  /** Property names in Coherent GT's own computed style and style object in every document, such as `-webkit-font-smoothing`. */
  own: Set<string>
  items: Item[]
}

type Result = { [key: string]: any }

/** The newest file in measurements/ whose name starts with `prefix`. */
export function newest(prefix: string): string {
  const files = fs.readdirSync(MEASUREMENTS).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).sort()
  if (!files.length) throw new Error(`measurements/ holds no ${prefix}*.json`)
  return path.join(MEASUREMENTS, files[files.length - 1]!)
}

/** p14's results in Coherent GT and in Chromium, the newest in measurements/ unless named. */
export function readP14(simFile = newest("p14-coherent-css-full-2026"), chromiumFile = newest("p14-coherent-css-full-chromium-")): P14 {
  const json = JSON.parse(fs.readFileSync(simFile, "utf8"))
  const failed = json.runs.filter((r: Result) => !r.result).map((r: Result) => `${r.label} (${r.missing ? "not found" : r.error})`)
  if (failed.length) throw new Error(`p14 has no results from ${failed.join(", ")}, so it can't say what every document keeps`)
  const sim: Result[] = json.runs.map((r: Result) => r.result)
  const chromium: Result = JSON.parse(fs.readFileSync(chromiumFile, "utf8")).result
  const atRules: Record<string, string> = JSON.parse(fs.readFileSync(path.join(MEASUREMENTS, "p14-at-rules.json"), "utf8"))
  const items: Item[] = []
  const add = (item: Omit<Item, "kept" | "chromium">, kept: (r: Result) => boolean) =>
    items.push({ ...item, kept: sim.every(kept), chromium: kept(chromium) })

  sim[0]!.properties.forEach((p: Result, i: number) => {
    if (p.name.startsWith("--")) return
    add({ group: "property", name: p.name, css: `.x { ${p.name}: inherit }` }, (r) => !!r.properties[i].inherit)
    // p14 tried a property's -webkit- form only where the engine dropped the property itself.
    if (p.webkit !== undefined) add({ group: "webkit", name: `-webkit-${p.name}`, css: `.x { -webkit-${p.name}: inherit }` }, (r) => !!r.properties[i].webkit)
    for (const k of Object.keys(p.keywords)) {
      add({ group: "keyword", name: `${p.name}: ${k}`, css: `.x { ${p.name}: ${k} }`, property: p.name, value: k }, (r) => !!r.properties[i].keywords[k])
    }
  })
  sim[0]!.functions.forEach((f: Result, i: number) => {
    add({ group: "function", name: f.name, css: `.x { ${f.prop}: ${f.value} }`, property: f.prop, value: f.value }, (r) => !!r.functions[i].kept)
  })
  sim[0]!.values.forEach((v: Result, i: number) => {
    add({ group: "value", name: `${v.prop}: ${v.value}`, css: `.x { ${v.prop}: ${v.value} }`, property: v.prop, value: v.value }, (r) => !!r.values[i].kept)
  })
  sim[0]!.units.forEach((u: Result, i: number) => {
    const inMedia = u.value.startsWith("(")
    const css = inMedia ? `@media ${u.value} { .x { z-index: 1 } }` : `.x { ${unitProperty(u.unit, u.value)}: ${u.value} }`
    add({ group: "unit", name: u.unit, css }, (r) => (inMedia ? sameQuery(r.units[i].kept, u.value) : !!r.units[i].kept))
  })
  sim[0]!.selectors.forEach((s: Result, i: number) => {
    add({ group: "selector", name: s.sel, css: `${s.sel} { z-index: 1 }` }, (r) => !!r.selectors[i].kept)
  })
  sim[0]!.atRules.forEach((a: Result, i: number) => {
    const text = atRules[a.name]
    if (!text) throw new Error(`measurements/p14-at-rules.json has no text for p14's ${a.name}`)
    add({ group: "atRule", name: a.name, css: text }, (r) => atRuleKept(r.atRules[i], text))
  })
  sim[0]!.media.forEach((m: Result, i: number) => {
    // Chromium writes some queries back in a form of its own, such as `(min-width: calc(2px))`.
    add({ group: "media", name: m.query, css: `@media ${m.query} { .x { z-index: 1 } }` }, (r) => (r === chromium ? parsed(r.media[i].parsed) : sameQuery(r.media[i].parsed, m.query)))
  })

  // The style object's keys include cssText and cssFloat, which p14 wrote as css-text and css-float, and which are no properties.
  const names = (r: Result) => new Set([...r.engine.computed, ...r.engine.styleKeys].filter((n: string) => !n.startsWith("--") && n !== "css-text" && n !== "css-float"))
  const each = sim.map(names)
  const own = new Set([...each[0]!].filter((n) => each.every((s) => s.has(n))))
  return { file: path.basename(simFile), mdnData: json.mdn, documents: json.runs.map((r: Result) => r.label), userAgent: sim[0]!.ua, own, items }
}

/** The property p14 tried a unit in. */
function unitProperty(unit: string, value: string): string {
  if (value.startsWith("rotate(")) return "transform"
  if (unit === "s" || unit === "ms") return "transition-duration"
  if (unit === "fr") return "grid-template-columns"
  return "width"
}

const parsed = (text: string | undefined) => !!text && text !== "not all"

/**
 * Whether the engine gave a media query back as written. Coherent GT gives `(resolution:
 * 1dppx)` back as `(resolution: )`, so it reads the feature and loses its value, and never
 * matches. Spacing, case, and the order of `and`'s terms don't count.
 */
function sameQuery(text: string | undefined, query: string): boolean {
  if (!parsed(text)) return false
  const norm = (q: string) =>
    q
      .toLowerCase()
      .replace(/\s+/g, "")
      .split(",")
      .map((part) => part.split("and").sort().join("and"))
      .join(",")
  return norm(text!) === norm(query)
}

/**
 * Whether the engine kept an at-rule. An engine without nesting keeps `.x { & .y { } }` as
 * `.x { }`, so a rule holding a rule counts only when the inner rule is there, and Coherent GT
 * rewrites `@import ... layer(p14)` to `@import ... not all`, which never applies.
 */
function atRuleKept(a: Result, text: string): boolean {
  if (!a.count) return false
  if (holdsARule(text) && !(a.inner > 0)) return false
  if (/ not all;?$/.test(a.text) && !text.includes("not all")) return false
  return true
}

/**
 * Whether an at-rule holds a style rule, or a style rule holds anything but declarations.
 * `@font-feature-values`'s `@styleset` is no rule of the CSSOM's, so it doesn't count.
 */
function holdsARule(text: string): boolean {
  const ast = csstree.parse(text)
  if (ast.type !== "StyleSheet") return false
  return ast.children.some((node) => {
    if (node.type === "Atrule") return !!node.block?.children.some((inner) => inner.type === "Rule")
    if (node.type === "Rule") return node.block.children.some((inner) => inner.type !== "Declaration")
    return false
  })
}
