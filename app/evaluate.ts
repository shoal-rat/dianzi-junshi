import { evaluateDecisionEngine } from "./decision/evaluation";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const mode = process.argv.includes("--fast") ? "fast" : process.argv.includes("--balanced") ? "balanced" : "deep";
const result = evaluateDecisionEngine(mode);
const outputDir = process.env.DJ_EVALUATION_DIR || join(import.meta.dir, "evaluation-results");
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, "latest.json"), JSON.stringify(result, null, 2) + "\n");
writeFileSync(join(outputDir, `decision-engine-${result.generatedAt.replace(/[:.]/g, "-")}.json`), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
console.log(`Evaluation saved to ${outputDir}`);
if (result.unsafeRate > .2 || result.abstentionAccuracy < .8) process.exitCode = 1;
