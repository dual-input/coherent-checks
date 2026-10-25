#!/usr/bin/env node
// Checks JavaScript and CSS files shipped into the sim against what Coherent GT runs and
// keeps, printing each failure with its line, and exits with 1 if it found any.
//
//   coherent-check <file>...

import path from "node:path"

import { checkFile, format } from "./index.ts"

const files = process.argv.slice(2)
if (!files.length) {
  console.error("usage: coherent-check <file>...")
  process.exit(2)
}
let found = 0
for (const file of files) {
  for (const f of checkFile(file)) {
    console.log(format(path.relative(process.cwd(), file).split(path.sep).join("/"), f))
    found++
  }
}
process.exitCode = found ? 1 : 0
