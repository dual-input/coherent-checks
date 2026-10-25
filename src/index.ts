import fs from "node:fs"

import { checkCss } from "./css.ts"
import type { Finding } from "./finding.ts"
import { checkJsFile } from "./js.ts"

export { checkCss, type CssData, type Verdicts } from "./css.ts"
export { format, type Finding } from "./finding.ts"
export { checkJs, checkJsFile } from "./js.ts"

/** Checks a file by its extension: a `.css` file's CSS, and any other file's JavaScript. */
export function checkFile(file: string): Finding[] {
  return file.toLowerCase().endsWith(".css") ? checkCss(fs.readFileSync(file, "utf8")) : checkJsFile(file)
}
