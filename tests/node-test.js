import { readFileSync } from "node:fs";
import { runGolden } from "./run.js";
const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const skills = { phq9: load("../skills/phq9.json"), menqol: load("../skills/menqol.json") };
const res = runGolden(skills, load("./golden.json"));
for (const r of res) console.log(r.pass ? "✓" : "✗", r.name, r.errs.join("；"));
const failed = res.filter((r) => !r.pass).length;
console.log(`\n${res.length - failed}/${res.length} 通过`);
process.exit(failed ? 1 : 0);
