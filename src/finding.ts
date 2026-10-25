export type Finding = {
  /** From 1, in the file checked. */
  line: number
  /** From 1. */
  column: number
  message: string
  /** Where esbuild's map says the failure came from, with that line's text. */
  source?: { file: string; line: number; column: number; text?: string }
}

/** A finding as the check prints it: the file's line, then the source's, then its text. */
export function format(file: string, f: Finding): string {
  const lines = [`${file}:${f.line}:${f.column}: ${f.message}`]
  if (f.source) {
    lines.push(`  from ${f.source.file}:${f.source.line}:${f.source.column}`)
    if (f.source.text !== undefined) lines.push(`    ${f.source.text.trim()}`)
  }
  return lines.join("\n")
}
