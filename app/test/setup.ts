import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 每次跑测试都用一个全新的数据目录，绝不碰真实的 ~/.dianzi-junshi
process.env.DIANZI_JUNSHI_HOME = mkdtempSync(join(tmpdir(), "junshi-test-"));
process.env.DJ_DISABLE_SEMANTIC = "1";
process.env.DJ_KEYCHAIN_MEMORY = "1";
