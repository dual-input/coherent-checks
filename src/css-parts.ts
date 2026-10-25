// The parts of a stylesheet the CSS check judges one by one: each function and the property
// it's in, each unit, each color's form, each part of a selector, each at-rule and form of
// one, and each part of a media query. The check and scripts/css-data.ts both name parts
// here, so the names in data/css.json, which the script reads off p14's results, are the
// names the check looks up for the CSS it checks.

import * as csstree from "css-tree"

/** The kinds of part data/css.json lists by name, each with what Coherent GT kept and dropped. */
export type Kind = "units" | "colors" | "selectors" | "atRules" | "media"

export type Part = { kind: Kind; name: string; node: csstree.CssNode }

/** A value's functions, its units and color forms, and the keywords at its top level. */
export type ValueParts = {
  functions: { name: string; node: csstree.FunctionNode }[]
  parts: Part[]
  keywords: { name: string; node: csstree.Identifier }[]
}

/** The name of a rule nested in another, which data/css.json lists among the at-rules. */
export const NESTING = "nesting"

const COLOR_FUNCTIONS = new Set(["rgb", "rgba", "hsl", "hsla"])
const HEX: Record<number, string> = { 3: "#rgb", 4: "#rgba", 6: "#rrggbb", 8: "#rrggbbaa" }

// Pseudo-elements CSS 2 wrote with one colon, which are the same pseudo-elements as `::before`.
const LEGACY_ELEMENTS = new Set(["before", "after", "first-line", "first-letter"])

/**
 * A value's parts. Keywords come only from its top level, since p14 tried each keyword as a
 * property's whole value, and `to` in `linear-gradient(to right, ...)` is no keyword of
 * `background-image`.
 */
export function valueParts(value: csstree.CssNode): ValueParts {
  const out: ValueParts = { functions: [], parts: [], keywords: [] }
  if (value.type === "Value") {
    for (const child of value.children) if (child.type === "Identifier") out.keywords.push({ name: child.name.toLowerCase(), node: child })
  }
  csstree.walk(value, (node) => {
    if (node.type === "Function") {
      const name = node.name.toLowerCase()
      out.functions.push({ name, node })
      if (COLOR_FUNCTIONS.has(name)) out.parts.push({ kind: "colors", name: colorForm(node), node })
    } else if (node.type === "Dimension") {
      out.parts.push({ kind: "units", name: node.unit.toLowerCase(), node })
    } else if (node.type === "Percentage") {
      out.parts.push({ kind: "units", name: "%", node })
    } else if (node.type === "Hash") {
      out.parts.push({ kind: "colors", name: HEX[node.value.length] ?? `#${"x".repeat(node.value.length)}`, node })
    }
  })
  return out
}

/** The form of an `rgb()`, `rgba()`, `hsl()`, or `hsla()`, which Coherent GT reads only with commas. */
function colorForm(fn: csstree.FunctionNode): string {
  const args = fn.children.toArray()
  const first = args[0]
  if (first?.type === "Identifier" && first.name.toLowerCase() === "from") return "from another color"
  if (args.some((a) => a.type === "Operator" && a.value === "/")) return "with a slash"
  const groups: csstree.CssNode[][] = [[]]
  for (const a of args) {
    if (a.type === "Operator" && a.value === ",") groups.push([])
    else groups[groups.length - 1]!.push(a)
  }
  if (groups.length === 1 && groups[0]!.length > 1) return "with spaces"
  if (groups[3]?.some((a) => a.type === "Percentage")) return "with an alpha as a percent"
  if (fn.name.toLowerCase().startsWith("hsl") && groups[0]?.some((a) => a.type === "Dimension")) return "with a hue unit"
  return "with commas"
}

/** A selector's parts: its pseudo-classes and pseudo-elements, combinators, attribute flags, `&`, and namespaces. */
export function selectorParts(selector: csstree.CssNode): Part[] {
  const out: Part[] = []
  const add = (name: string, node: csstree.CssNode) => out.push({ kind: "selectors", name, node })
  csstree.walk(selector, (node) => {
    if (node.type === "PseudoClassSelector") {
      const name = node.name.toLowerCase()
      add(LEGACY_ELEMENTS.has(name) ? `::${name}` : `:${name}`, node)
      // `:nth-child(2 of .y)` counts only the siblings matching `.y`, a form of its own.
      const nth = node.children?.first
      if (nth?.type === "Nth" && nth.selector) add(`:${name}(of)`, node)
    } else if (node.type === "PseudoElementSelector") {
      add(`::${node.name.toLowerCase()}`, node)
    } else if (node.type === "Combinator") {
      add(node.name === " " ? "descendant" : node.name, node)
    } else if (node.type === "NestingSelector") {
      add("&", node)
    } else if (node.type === "AttributeSelector" && node.flags) {
      add(`[${node.flags.toLowerCase()}]`, node)
    } else if (node.type === "TypeSelector" && node.name.includes("|")) {
      add("|", node)
    }
  })
  return out
}

/** An at-rule's name and its forms, such as `@import layer()`; a media query's parts come from `mediaParts`. */
export function atRuleParts(node: csstree.Atrule): Part[] {
  const name = node.name.toLowerCase()
  const out: Part[] = [{ kind: "atRules", name: `@${name}`, node }]
  if (node.prelude?.type !== "AtrulePrelude") return out
  const add = (form: string, at: csstree.CssNode) => out.push({ kind: "atRules", name: form, node: at })
  for (const p of node.prelude.children) {
    if (name === "import" && p.type === "Function" && (p.name === "layer" || p.name === "supports")) add(`@import ${p.name}()`, p)
    if (name === "import" && p.type === "Identifier" && p.name === "layer") add("@import layer()", p)
  }
  if (name === "supports") {
    csstree.walk(node.prelude, (p) => {
      if (p.type === "FeatureFunction" && p.feature === "selector") add("@supports selector()", p)
      else if (p.type === "Identifier" && p.name.toLowerCase() === "not") add("@supports not", p)
    })
  }
  return out
}

/** A media query's parts: `only` or `not`, its media type, each feature, `and` and `or`, and the forms MQ4 added. */
export function mediaParts(query: csstree.MediaQuery): Part[] {
  const out: Part[] = []
  const add = (name: string, node: csstree.CssNode, kind: Kind = "media") => out.push({ kind, name, node })
  if (query.modifier) add(query.modifier.toLowerCase(), query)
  if (query.mediaType) add(query.mediaType.toLowerCase(), query)
  const condition = (c: csstree.Condition) => {
    for (const child of c.children) {
      if (child.type === "Feature") {
        add(`(${child.name.toLowerCase()})`, child)
        if (!child.value) continue
        csstree.walk(child.value, (v) => {
          if (v.type === "Function") add("a function in a feature", v)
          else if (v.type === "Dimension") add(v.unit.toLowerCase(), v, "units")
        })
      } else if (child.type === "FeatureRange") {
        add("range syntax", child)
      } else if (child.type === "Identifier") {
        const word = child.name.toLowerCase()
        add(word === "not" ? "not inside a condition" : word, child)
      } else if (child.type === "Condition") {
        condition(child)
      }
    }
  }
  if (query.condition) condition(query.condition)
  return out
}
