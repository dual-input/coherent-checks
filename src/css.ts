// The Coherent GT check for CSS. MSFS 2024 draws pages in the sim in Coherent GT, which drops
// a declaration it can't read, and a whole rule when it can't read the rule's selector or
// at-rule, all without an error, so CSS that draws in a browser goes missing in the sim. So
// this passes only what Dual Input's probe p14 measured the engine keeping, fails the rest
// where the developer writing it sees it, and names the rule each failure sits in
// (Dual Input, record/areas/interface/decisions.md, "The Coherent GT check covers the CSS we
// ship into the sim").
//
// data/css.json holds p14's answers, which scripts/css-data.ts writes. data/css-rules.json
// holds by hand what those answers can't say: what another probe measured, and what the
// engine parses and then ignores.

import fs from "node:fs"

import * as csstree from "css-tree"

import { atRuleParts, mediaParts, NESTING, selectorParts, valueParts, type Kind, type Part } from "./css-parts.ts"
import type { Finding } from "./finding.ts"

/** Of one kind of part, what Coherent GT kept, and what it dropped where Chromium kept it. */
export type Verdicts = { kept: string[]; dropped: string[] }

export type CssData = {
  measured: { probe: string; file: string; mdnData: string; documents: string[]; userAgent: string }
  properties: Verdicts
  /** Each property's keywords that Coherent GT dropped where Chromium kept them, with `*` for those dropped in any property. */
  keywords: Record<string, string[]>
  /** The properties each function was kept in and dropped in. */
  functions: Record<string, Verdicts>
  units: Verdicts
  colors: Verdicts
  selectors: Verdicts
  atRules: Verdicts
  media: Verdicts
}

/** An entry of data/css-rules.json: what it matches, the message it fails with, and how we know. */
type Rule = {
  property?: string
  value?: string
  unit?: string
  selector?: string
  atRule?: string
  media?: string
  message?: string
  because: string
}

type Verdict = "kept" | "dropped" | "untested"

type Sets = { kept: Set<string>; dropped: Set<string> }

const read = (file: string) => JSON.parse(fs.readFileSync(new URL(`../data/${file}`, import.meta.url), "utf8"))
const DATA: CssData = read("css.json")
const RULES: { kept: Rule[]; dropped: Rule[]; ignored: Rule[] } = read("css-rules.json")

const sets = (v: Verdicts): Sets => ({ kept: new Set(v.kept), dropped: new Set(v.dropped) })
const PROPERTIES = sets(DATA.properties)
const PARTS: Record<Kind, Sets> = {
  units: sets(DATA.units),
  colors: sets(DATA.colors),
  selectors: sets(DATA.selectors),
  atRules: sets(DATA.atRules),
  media: sets(DATA.media),
}
for (const rule of RULES.kept) {
  if (rule.property) PROPERTIES.kept.add(rule.property)
  if (rule.unit) PARTS.units.kept.add(rule.unit)
  if (rule.selector) PARTS.selectors.kept.add(rule.selector)
  if (rule.atRule) PARTS.atRules.kept.add(rule.atRule)
  if (rule.media) PARTS.media.kept.add(rule.media)
}

const UNTESTED = "is untested in Coherent GT, so count on it nowhere until a probe measures it"

// Declarations only another engine reads, which cost nothing where Coherent GT drops them.
const OTHER_ENGINES = /^-(moz|ms)-/

/** Where a finding sits: the rule's selector, for its message, and what holds it. */
type Where = { selector?: string; inRule: boolean; keyframes: boolean }

/** A declaration's failures, and whether a kept twin beside it would carry its style instead. */
type Judged = { node: csstree.Declaration; property: string; failures: { node: csstree.CssNode; message: string }[]; coverable: boolean }

/** Checks one stylesheet. */
export function checkCss(code: string): Finding[] {
  const check = new Check(code)
  const ast = csstree.parse(code, { positions: true, parseCustomProperty: true })
  if (ast.type === "StyleSheet") check.items(ast.children, { inRule: false, keyframes: false })
  return check.found.sort((a, b) => a.line - b.line || a.column - b.column)
}

class Check {
  readonly found: Finding[] = []
  private readonly code: string

  constructor(code: string) {
    this.code = code
  }

  items(children: csstree.List<csstree.CssNode>, where: Where): void {
    const declarations: csstree.Declaration[] = []
    for (const node of children) {
      if (node.type === "Rule") this.rule(node, where)
      else if (node.type === "Atrule") this.atRule(node, where)
      else if (node.type === "Declaration") declarations.push(node)
      else if (node.type === "Raw" && node.value.trim()) this.flag(node, `the check can't read ${quote(node.value)}, so it fails until a probe measures it`, where)
    }
    this.declarations(declarations, where)
  }

  private rule(node: csstree.Rule, where: Where): void {
    if (where.inRule) {
      this.part({ kind: "atRules", name: NESTING, node }, where)
      return
    }
    const selector = this.text(node.prelude)
    const inside: Where = { selector, inRule: true, keyframes: false }
    // A keyframe's `from` and `50%` are no selectors.
    if (!where.keyframes && !this.selectors(node.prelude, inside)) return
    this.items(node.block.children, inside)
  }

  /** Whether every selector of a rule's list passes, since Coherent GT drops the whole rule for one it can't read. */
  private selectors(prelude: csstree.SelectorList | csstree.Raw, where: Where): boolean {
    let ok = true
    // css-tree gives a list it can't read whole as raw text, so each selector of it is read alone.
    const list = prelude.type === "SelectorList" ? prelude.children.toArray() : splitList(prelude.value).map((text) => parseSelector(text) ?? text)
    for (const selector of list) {
      if (typeof selector === "string") {
        this.flag(prelude, `the check can't read the selector ${quote(selector)}, so it fails until a probe measures it`, where)
        ok = false
        continue
      }
      for (const part of selectorParts(selector)) ok = this.part(part, where) && ok
    }
    return ok
  }

  private atRule(node: csstree.Atrule, where: Where): void {
    if (where.inRule) {
      this.part({ kind: "atRules", name: NESTING, node }, where)
      return
    }
    const at: Where = { inRule: false, keyframes: false }
    if (!atRuleParts(node).every((part) => this.part(part, at))) return
    const name = node.name.toLowerCase()
    if (name === "media") {
      const list = node.prelude?.type === "AtrulePrelude" ? node.prelude.children.first : undefined
      if (list?.type !== "MediaQueryList") {
        this.flag(node, `the check can't read the media query of ${quote(this.text(node).split("{")[0]!)}, so it fails until a probe measures it`, at)
        return
      }
      let applies = false
      for (const query of list.children) if (query.type === "MediaQuery" && this.mediaQuery(query)) applies = true
      if (!applies) return
    }
    // A font face's descriptors, such as `src`, are no properties.
    if (!node.block || name === "font-face") return
    this.items(node.block.children, { inRule: false, keyframes: name.endsWith("keyframes") })
  }

  /** Whether a media query passes, so the rules under it can apply. */
  private mediaQuery(query: csstree.MediaQuery): boolean {
    let ok = true
    for (const part of mediaParts(query)) ok = this.part(part, { inRule: false, keyframes: false }) && ok
    csstree.walk(query, (node) => {
      if (node.type !== "Feature") return
      const text = normalize(this.text(node))
      for (const rule of RULES.ignored) {
        if (rule.media && normalize(rule.media) === text) {
          this.flag(node, rule.message!, { inRule: false, keyframes: false })
          ok = false
        }
      }
    })
    return ok
  }

  /**
   * Checks a block's declarations. Coherent GT drops a declaration, not its rule, so one it
   * drops passes beside a kept declaration of the same property or of its `-webkit-` twin,
   * as autoprefixer writes `-webkit-user-select` before `user-select`.
   */
  private declarations(list: csstree.Declaration[], where: Where): void {
    const judged = list.map((d) => this.judge(d))
    for (const d of judged) {
      if (!d.failures.length) continue
      const twins = new Set([d.property, d.property.startsWith("-webkit-") ? d.property.slice(8) : `-webkit-${d.property}`])
      if (d.coverable && judged.some((o) => o !== d && twins.has(o.property) && !o.failures.length)) continue
      for (const f of d.failures) this.flag(f.node, f.message, where)
    }
  }

  private judge(node: csstree.Declaration): Judged {
    const custom = node.property.startsWith("--")
    const property = custom ? node.property : node.property.toLowerCase()
    const judged: Judged = { node, property, failures: [], coverable: !custom }
    const fail = (at: csstree.CssNode, message: string) => judged.failures.push({ node: at, message })
    if (OTHER_ENGINES.test(property)) return judged
    if (!custom) {
      const verdict = PROPERTIES.kept.has(property) ? "kept" : PROPERTIES.dropped.has(property) ? "dropped" : "untested"
      if (verdict !== "kept") {
        fail(node, `${property} ${verdict === "dropped" ? "is dropped by Coherent GT" : UNTESTED}`)
        return judged
      }
    }
    if (node.value.type !== "Value") return judged
    const parts = valueParts(node.value)
    // A custom property holds its value until a var() puts it into a declaration, which then
    // breaks wherever it goes, as Tailwind 3's --tw-shadow does with rgb() in spaces.
    const inside = custom ? `, so ${property} breaks wherever var() puts it` : ""
    if (!custom) {
      for (const k of parts.keywords) {
        if (DATA.keywords[property]?.includes(k.name) || DATA.keywords["*"]?.includes(k.name)) fail(k.node, `${property}: ${k.name} is dropped by Coherent GT`)
      }
    }
    for (const f of parts.functions) {
      const verdict = functionVerdict(f.name, custom ? undefined : property)
      if (verdict === "untested") fail(f.node, `${f.name}() ${UNTESTED}${inside}`)
      else if (verdict === "dropped") fail(f.node, `${f.name}()${custom || !DATA.functions[f.name]?.kept.length ? "" : ` in ${property}`} is dropped by Coherent GT${inside}`)
    }
    for (const part of parts.parts) {
      const verdict = partVerdict(part)
      if (verdict !== "kept") fail(part.node, `${describe(part)} ${verdict === "dropped" ? "is dropped by Coherent GT" : UNTESTED}${inside}`)
    }
    for (const rule of RULES.dropped) if (matches(rule, property, parts)) fail(node, rule.message!)
    for (const rule of RULES.ignored) {
      if (matches(rule, property, parts)) {
        fail(node, rule.message!)
        judged.coverable = false
      }
    }
    return judged
  }

  /** Whether a part passes, recording a finding where it doesn't. */
  private part(part: Part, where: Where): boolean {
    const verdict = partVerdict(part)
    if (verdict === "kept") return true
    const what = verdict === "dropped" ? "is dropped by Coherent GT" : UNTESTED
    const then =
      part.kind === "selectors"
        ? ", which drops the whole rule"
        : part.kind === "media"
          ? ", so no rule under this query applies"
          : part.kind === "atRules" && part.name !== NESTING
            ? ", with every rule inside it"
            : ""
    this.flag(part.node, `${describe(part)} ${what}${then}`, where)
    return false
  }

  private flag(node: csstree.CssNode, message: string, where: Where): void {
    const loc = node.loc?.start ?? { line: 1, column: 1 }
    this.found.push({ line: loc.line, column: loc.column, message: where.selector ? `${message}, in ${where.selector}` : message })
  }

  /** A node's text as the file writes it, on one line. */
  private text(node: csstree.CssNode): string {
    const loc = node.loc
    const text = loc ? this.code.slice(loc.start.offset, loc.end.offset) : csstree.generate(node)
    return text.replace(/\s+/g, " ").trim()
  }
}

/**
 * A function in a property passes where p14 kept it, fails where p14 dropped it, and in a
 * property p14 never tried it in, passes if p14 kept it anywhere, as `circle()` passes in
 * `-webkit-clip-path` and fails in `clip-path`.
 */
function functionVerdict(name: string, property: string | undefined): Verdict {
  const f = DATA.functions[name]
  if (!f) return "untested"
  if (property && f.kept.includes(property)) return "kept"
  if (property && f.dropped.includes(property)) return "dropped"
  return f.kept.length ? "kept" : "dropped"
}

function partVerdict(part: Part): Verdict {
  const sets = PARTS[part.kind]
  if (sets.kept.has(part.name)) return "kept"
  if (sets.dropped.has(part.name)) return "dropped"
  // A media feature's `min-` and `max-` forms are the same feature, which p14 tried in one form
  // or the other, such as `min-height` without `max-height`.
  const feature = part.kind === "media" ? /^\((?:min-|max-)?(.+)\)$/.exec(part.name) : null
  if (feature) {
    const forms = [`(${feature[1]})`, `(min-${feature[1]})`, `(max-${feature[1]})`]
    if (forms.some((f) => sets.dropped.has(f))) return "dropped"
    if (forms.some((f) => sets.kept.has(f))) return "kept"
  }
  return "untested"
}

/** A part as a message names it. */
function describe(part: Part): string {
  if (part.kind === "units") return `the ${part.name} unit`
  if (part.kind === "colors") return part.name.startsWith("#") ? `a ${part.name} color` : `${(part.node as csstree.FunctionNode).name}() ${part.name}`
  if (part.kind === "media") return `${part.name} in a media query`
  if (part.kind === "atRules" && part.name === NESTING) return "a rule nested in another"
  return part.name
}

/** Whether a dropped or ignored entry of data/css-rules.json matches a declaration. */
function matches(rule: Rule, property: string, parts: ReturnType<typeof valueParts>): boolean {
  if (rule.property !== property) return false
  if (rule.value && !parts.keywords.some((k) => k.name === rule.value)) return false
  if (rule.unit && !parts.parts.some((p) => p.kind === "units" && p.name === rule.unit)) return false
  return true
}

/** One selector of a list, or undefined where css-tree can't read it, as with the column combinator `||`. */
function parseSelector(text: string): csstree.CssNode | undefined {
  try {
    return csstree.parse(text, { context: "selector", positions: true })
  } catch {
    return undefined
  }
}

/** A selector list's selectors, split at the commas outside parentheses and brackets. */
function splitList(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === "(" || c === "[") depth++
    else if (c === ")" || c === "]") depth--
    else if (c === "," && depth === 0) {
      out.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(text.slice(start).trim())
  return out.filter(Boolean)
}

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, "")

const quote = (text: string) => {
  const one = text.replace(/\s+/g, " ").trim()
  return `"${one.length > 60 ? `${one.slice(0, 57)}...` : one}"`
}
