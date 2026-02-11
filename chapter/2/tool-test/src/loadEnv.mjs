/**
 * 从 monorepo 根目录或当前工作目录加载 .env，供同目录下其他入口在首行 import 使用。
 * 兼容从仓库根或从 chapter/2/tool-test 运行时的 cwd。
 */
import path from "path";
import { fileURLToPath } from "url";
import fs from "node:fs";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envCandidates = [
  path.resolve(__dirname, "../../../../.env"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env"),
];
const envPath = envCandidates.find((p) => fs.existsSync(p));
if (envPath) dotenv.config({ path: envPath });
