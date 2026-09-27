// エディタ補完用の JSON Schema を書き出す。
//   bun run schema
import { writeFileSync } from "node:fs";
import { z } from "zod";
import { fullScenarioSchema } from "./schema.ts";

const out = process.argv[2] ?? "schema/scenario.schema.json";
const schema = z.toJSONSchema(fullScenarioSchema(), { unrepresentable: "any" });
writeFileSync(
	out,
	JSON.stringify({ title: "gyakusai シナリオ", ...schema }, null, 2) + "\n",
);
console.log(`書き出しました: ${out}`);
