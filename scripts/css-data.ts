// Writes data/css.json, the CSS check's lists, from p14's results: each property, keyword,
// function, unit, color form, selector part, at-rule, and media query part Coherent GT kept,
// and each it dropped where Chromium kept it, named by src/css-parts.ts as the check names
// the parts of the CSS it checks. A sample neither engine kept says nothing of Coherent GT,
// so it adds nothing.
//
//   npm run css-data
//   npm run css-data -- measurements/<p14's results>.json measurements/<its Chromium baseline>.json
//
// With no files named, it reads the newest of each in measurements/.

import fs from "node:fs"
import path from "node:path"

import * as csstree from "css-tree"

import { atRuleParts, mediaParts, NESTING, selectorParts, valueParts, type Kind, type Part } from "../src/css-parts.ts"
import type { CssData, Verdicts } from "../src/css.ts"
import { readP14, type Item } from "./p14.ts"

const [simFile, chromiumFile] = process.argv.slice(2)
const p14 = readP14(simFile, chromiumFile)

/** Names kept, and dropped where Chromium kept them; a name kept anywhere counts as kept. */
class Tally {
  readonly kept = new Set<string>()
  readonly dropped = new Set<string>()

  add(name: string, item: Item): void {
    if (item.kept) this.kept.add(name)
    else if (item.chromium) this.dropped.add(name)
  }

  verdicts(): Verdicts {
    return { kept: [...this.kept].sort(), dropped: [...this.dropped].filter((n) => !this.kept.has(n)).sort() }
  }
}

const properties = new Tally()
const parts: Record<Kind, Tally> = { units: new Tally(), colors: new Tally(), selectors: new Tally(), atRules: new Tally(), media: new Tally() }
const functions = new Map<string, Tally>()
const keywords = new Map<string, Set<string>>()
const byGroup = (group: Item["group"]) => p14.items.filter((i) => i.group === group)
const tally = (found: Part[], item: Item) => {
  for (const part of found) parts[part.kind].add(part.name, item)
}
const fn = (name: string) => functions.get(name) ?? functions.set(name, new Tally()).get(name)!
const keyword = (property: string, name: string) => (keywords.get(property) ?? keywords.set(property, new Set()).get(property)!).add(name.toLowerCase())
const value = (text: string) => csstree.parse(text.replace(/\s*!important\s*$/, ""), { context: "value" })

// `inherit` is a value of every property, so Chromium dropping one says only that Chromium
// lacks it, and a property Coherent GT dropped is dropped whatever Chromium did. p14 tried a
// -webkit- form only where the engine dropped the plain property, and Chromium, which kept
// most of those, never tried it.
const propertyItems = [...byGroup("property"), ...byGroup("webkit")]
for (const item of propertyItems) (item.kept ? properties.kept : properties.dropped).add(item.name)
// The engine's own names, such as -webkit-font-smoothing, which mdn-data doesn't list, are in
// its style object, but a property p14 tried and saw dropped stays dropped.
const tried = new Set(propertyItems.map((i) => i.name))
for (const name of p14.own) if (!tried.has(name) || properties.kept.has(name)) properties.kept.add(name)

for (const item of byGroup("keyword")) {
  if (!item.kept && item.chromium && properties.kept.has(item.property!)) keyword(item.property!, item.value!)
}

// A function sample says the function under test was dropped in its property, and, where kept,
// that everything in it was kept. The function under test is the one the sample is named for,
// or its -webkit- form, as `-webkit-linear-gradient(red, blue)` samples `linear-gradient()`.
for (const item of byGroup("function")) {
  if (!properties.kept.has(item.property!)) continue
  const found = valueParts(value(item.value!))
  if (item.kept) {
    for (const f of found.functions) fn(f.name).kept.add(item.property!)
    tally(found.parts, item)
  } else if (item.chromium) {
    const tested = found.functions.find((f) => f.name.replace(/^-(webkit|moz)-/, "") === item.name.slice(0, -2).toLowerCase())
    if (tested) fn(tested.name).dropped.add(item.property!)
  }
}

// A value form, such as `rgb(1 2 3)`, says which forms of a function and which units were
// kept, and a lone keyword dropped is one the engine lacks, `revert-layer` in every property.
const CSS_WIDE = new Set(["initial", "inherit", "unset", "revert", "revert-layer"])
for (const item of byGroup("value")) {
  const found = valueParts(value(item.value!))
  if (item.kept) for (const f of found.functions) fn(f.name).kept.add(item.property!)
  tally(found.parts, item)
  if (!item.kept && item.chromium && /^-?[a-z][a-z0-9-]*$/i.test(item.value!)) {
    keyword(CSS_WIDE.has(item.value!.toLowerCase()) ? "*" : item.property!, item.value!)
  }
}

for (const item of byGroup("unit")) parts.units.add(item.name.toLowerCase(), item)

for (const item of byGroup("selector")) {
  let selector: csstree.CssNode
  try {
    selector = csstree.parse(item.name, { context: "selectorList" })
  } catch {
    // css-tree can't read the column combinator `||`, so neither can the check, which fails it.
    continue
  }
  tally(selectorParts(selector), item)
}

for (const item of byGroup("atRule")) {
  const sheet = csstree.parse(item.css)
  if (sheet.type !== "StyleSheet") continue
  for (const node of sheet.children) {
    if (node.type === "Atrule") tally(atRuleParts(node), item)
    if (node.type === "Rule" && node.block.children.some((c) => c.type === "Rule" || c.type === "Atrule")) parts.atRules.add(NESTING, item)
  }
}

for (const item of byGroup("media")) {
  const list = csstree.parse(item.name, { context: "mediaQueryList" })
  csstree.walk(list, (node) => {
    if (node.type === "MediaQuery") tally(mediaParts(node), item)
  })
}

const sorted = <T>(map: Map<string, T>, out: (t: T) => any) => Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, out(v)]))
const data: CssData = {
  measured: { probe: "p14", file: p14.file, mdnData: p14.mdnData, documents: p14.documents, userAgent: p14.userAgent },
  properties: properties.verdicts(),
  keywords: sorted(keywords, (s) => [...s].sort()),
  functions: sorted(functions, (t) => ({ kept: [...t.kept].sort(), dropped: [...t.dropped].filter((p) => !t.kept.has(p)).sort() })),
  units: parts.units.verdicts(),
  colors: parts.colors.verdicts(),
  selectors: parts.selectors.verdicts(),
  atRules: parts.atRules.verdicts(),
  media: parts.media.verdicts(),
}
const out = path.join(import.meta.dirname, "..", "data", "css.json")
fs.writeFileSync(out, JSON.stringify(data, null, 2) + "\n")
const count = (v: Verdicts) => `${v.kept.length} kept, ${v.dropped.length} dropped`
console.log(`wrote data/css.json from ${p14.file}:`)
console.log(`  properties: ${count(data.properties)}`)
console.log(`  keywords dropped: ${Object.values(data.keywords).flat().length}, in ${Object.keys(data.keywords).length} properties`)
console.log(`  functions: ${Object.keys(data.functions).length}`)
for (const kind of Object.keys(parts) as Kind[]) console.log(`  ${kind}: ${count(data[kind])}`)
