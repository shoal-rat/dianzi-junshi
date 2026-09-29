import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 每次跑测试都用一个全新的数据目录，绝不碰真实的 ~/.dianzi-junshi
process.env.DIANZI_JUNSHI_HOME = mkdtempSync(join(tmpdir(), "junshi-test-"));
process.env.DJ_DISABLE_SEMANTIC = "1";
process.env.DJ_KEYCHAIN_MEMORY = "1";
// 测试默认按中文系统跑；英文用例自己显式指定（设置里的 language 或档案的 lang）
process.env.DJ_LANG = "zh";
