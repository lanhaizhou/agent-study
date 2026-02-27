/**
 * MCP Server：根据路由地址解析并打开对应页面源码文件（通用版）。
 *
 * 功能：
 * - 注册 Tool：open_route_source，输入路由 path + 项目根目录，返回该项目下对应的页面源码文件路径
 * - 支持 Vue 2 / Vue 3、Next.js（App Router / Pages Router）、React（Vite/CRA 等）等常见前端项目，按目录结构自动识别约定
 * - 当路由为后端返回的动态路由（如 /user/123）无法精确匹配时，可传 keyword 参数，按「路由语义段 + 关键词」在页面目录中搜索并返回最佳匹配文件
 *
 * 环境变量：ROUTE_TO_FILE_PROJECT_ROOT 为默认项目根目录；Tool 也可通过参数 projectRoot 指定，便于切换项目。
 *
 * 运行方式：由 Cursor 等 MCP Client 通过 stdio 启动；或 ROUTE_TO_FILE_PROJECT_ROOT=... node route-to-file-mcp.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DEFAULT_PROJECT_ROOT =
  process.env.ROUTE_TO_FILE_PROJECT_ROOT || process.cwd();

const server = new McpServer({
  name: "route-to-file-mcp",
  version: "1.0.0",
});

/**
 * 将路由 path 规范化为 segments（去掉前导 /，按 / 拆分）
 * 例如："/guild/salary" -> ["guild", "salary"]
 */
function normalizeRoutePath(routePath) {
  const normalized = routePath.replace(/^\//, "").trim();
  return normalized ? normalized.split("/").filter(Boolean) : [];
}

/**
 * 在 projectRoot 下生成「Vue / React 风格」候选路径：views 或 pages 下的 index.vue/.vue/.tsx 等
 * dirs: ["src/views", "src/pages", "views", "pages"] 中存在的目录
 */
function* vueOrReactCandidates(projectRoot, segments, dirs) {
  if (segments.length === 0) return;
  const dirPath = path.join(projectRoot, ...segments);
  const baseName = path.basename(dirPath);
  const exts = [
    [".vue"],
    [".tsx"],
    [".jsx"],
    [".js"],
  ];
  for (const dir of dirs) {
    const base = path.join(projectRoot, dir);
    for (const [ext] of exts) {
      yield path.join(base, ...segments, "index" + ext);
      yield path.join(base, ...segments.slice(0, -1), baseName + ext);
    }
  }
}

/**
 * Next.js App Router：app/{path}/page.tsx | page.js | page.jsx
 */
function* nextAppRouterCandidates(projectRoot, segments) {
  if (segments.length === 0) {
    const appDir = path.join(projectRoot, "app");
    yield path.join(appDir, "page.tsx");
    yield path.join(appDir, "page.js");
    yield path.join(appDir, "page.jsx");
    return;
  }
  const pageDir = path.join(projectRoot, "app", ...segments);
  for (const name of ["page.tsx", "page.js", "page.jsx"]) {
    yield path.join(pageDir, name);
  }
}

/**
 * Next.js Pages Router：pages/{path}.tsx 或 pages/{path}/index.tsx 等
 */
function* nextPagesRouterCandidates(projectRoot, segments) {
  if (segments.length === 0) {
    const pagesDir = path.join(projectRoot, "pages");
    for (const name of ["index.tsx", "index.jsx", "index.js"]) {
      yield path.join(pagesDir, name);
    }
    return;
  }
  const pagesDir = path.join(projectRoot, "pages");
  const filePath = path.join(pagesDir, ...segments);
  const baseName = path.basename(filePath);
  const parentDir = path.dirname(filePath);
  for (const ext of [".tsx", ".jsx", ".js"]) {
    yield path.join(parentDir, baseName + ext);
    yield path.join(filePath, "index" + ext);
  }
}

/**
 * 根据项目根目录检测存在的约定目录，返回约定名称列表
 */
async function detectConventions(projectRoot) {
  const candidates = [
    { name: "next-app", dir: "app" },
    { name: "next-pages", dir: "pages" },
    { name: "src-views", dir: "src/views" },
    { name: "src-pages", dir: "src/pages" },
    { name: "views", dir: "views" },
    { name: "pages", dir: "pages" },
  ];
  const found = [];
  for (const { name, dir } of candidates) {
    try {
      const full = path.join(projectRoot, dir);
      const stat = await fs.stat(full);
      if (stat.isDirectory()) found.push({ name, dir });
    } catch {
      // 忽略不存在的目录
    }
  }
  return found;
}

/**
 * 根据路由 path 与项目根目录，生成所有可能的页面文件候选路径（去重、按约定顺序）
 * 顺序：Next.js App -> Next.js Pages -> Vue/React 的 src/views -> src/pages -> views -> pages
 */
async function resolveRouteToFilePaths(routePath, projectRoot) {
  const segments = normalizeRoutePath(routePath);
  const conventions = await detectConventions(projectRoot);
  const seen = new Set();
  const out = [];

  const push = (p) => {
    const n = path.normalize(p);
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  };

  const hasApp = conventions.some((c) => c.dir === "app");
  const hasPages = conventions.some((c) => c.dir === "pages");
  const vueLikeDirs = conventions
    .filter((c) => ["src/views", "src/pages", "views", "pages"].includes(c.dir))
    .map((c) => c.dir);

  if (hasApp) {
    for (const p of nextAppRouterCandidates(projectRoot, segments)) push(p);
  }
  if (hasPages) {
    for (const p of nextPagesRouterCandidates(projectRoot, segments)) push(p);
  }
  if (vueLikeDirs.length > 0) {
    for (const p of vueOrReactCandidates(projectRoot, segments, vueLikeDirs)) push(p);
  }

  return out;
}

/**
 * 从路由 path 中提取可用于匹配的「关键词」：去掉纯数字、类 UUID 等动态参数段，保留语义段
 * 例如：/guild/42/salary -> ["guild", "salary"]；/user/abc-123 -> ["user"]
 */
function extractSearchTermsFromRoute(routePath) {
  const segments = normalizeRoutePath(routePath);
  const filtered = segments.filter((seg) => {
    if (/^\d+$/.test(seg)) return false;
    if (/^[0-9a-f-]{36}$/i.test(seg)) return false;
    if (/^[0-9a-f]{24}$/i.test(seg)) return false;
    return true;
  });
  return [...new Set(filtered)];
}

/** 判断是否为页面类文件：扩展名或 Next.js 的 page.* */
function isPageFile(relativePath, conventionDir) {
  const lower = relativePath.toLowerCase();
  if (conventionDir === "app") {
    return lower.endsWith("page.tsx") || lower.endsWith("page.js") || lower.endsWith("page.jsx");
  }
  return /\.(vue|tsx|jsx|js)$/.test(relativePath);
}

/**
 * 在约定目录下递归收集所有页面文件的相对路径（相对于 projectRoot）
 */
async function collectPageFilesUnder(projectRoot, dir, conventionDir, base = "") {
  const full = path.join(projectRoot, dir, base);
  const entries = await fs.readdir(full, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      out.push(...(await collectPageFilesUnder(projectRoot, dir, conventionDir, rel)));
    } else if (e.isFile() && isPageFile(rel, conventionDir)) {
      out.push(path.join(dir, rel));
    }
  }
  return out;
}

/**
 * 按「路由提取词 + 可选关键词」在页面目录中搜索，返回路径中包含这些词的页面文件（按匹配度排序）
 * 匹配度：路径（小写）中包含的搜索词数量越多、路径越短越靠前
 */
async function searchByKeyword(projectRoot, routePath, keyword, conventions) {
  const terms = [
    ...extractSearchTermsFromRoute(routePath),
    ...(keyword ? String(keyword).trim().split(/[\s,]+/).filter(Boolean) : []),
  ];
  const termsLower = [...new Set(terms)].map((t) => t.toLowerCase());
  if (termsLower.length === 0) return [];

  const pageDirs = conventions.map((c) => c.dir);
  const allFiles = [];
  for (const dir of pageDirs) {
    const conventionDir = dir === "app" ? "app" : "vue-like";
    const files = await collectPageFilesUnder(projectRoot, dir, conventionDir);
    for (const f of files) {
      const fullPath = path.join(projectRoot, f);
      allFiles.push(fullPath);
    }
  }

  const scored = allFiles.map((fullPath) => {
    const rel = path.relative(projectRoot, fullPath);
    const relLower = rel.toLowerCase().replace(/\\/g, "/");
    let matchCount = 0;
    for (const t of termsLower) {
      if (relLower.includes(t)) matchCount += 1;
    }
    return { fullPath, rel, matchCount };
  });

  const filtered = scored.filter((s) => s.matchCount > 0);
  filtered.sort((a, b) => {
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    return a.rel.length - b.rel.length;
  });
  return filtered.map((s) => s.fullPath);
}

/** 在候选路径中返回第一个存在的文件路径，都不存在则返回 null */
async function findFirstExistingFile(candidatePaths) {
  for (const p of candidatePaths) {
    try {
      await fs.access(p);
      return p;
    } catch {
      continue;
    }
  }
  return null;
}

// 注册工具：open_route_source
// - 入参：routePath（必填）、projectRoot（可选，默认取 env 或 cwd）
// - 返回：MCP 约定的 { content: [{ type: "text", text }] }
server.registerTool(
  "open_route_source",
  {
    description:
      "根据路由地址打开前端项目（Vue2/Vue3、Next.js、React 等）中对应的页面源码文件。输入路由 path 和可选的项目根目录，先按约定做精确路径匹配；若未找到（如后端返回的动态路由 /user/123），可传 keyword 参数，按「路由提取词+关键词」在页面目录中搜索并返回最佳匹配文件路径，便于在编辑器中打开。",
    inputSchema: {
      routePath: z
        .string()
        .describe(
          "路由 path，如 /dashboard/settings、/user/list（可带或不带前导斜杠）；若为后端返回的动态路由如 /user/123，可配合 keyword 做关键词查找",
        ),
      projectRoot: z
        .string()
        .optional()
        .describe(
          "项目根目录绝对路径；不传则使用环境变量 ROUTE_TO_FILE_PROJECT_ROOT 或当前工作目录",
        ),
      keyword: z
        .string()
        .optional()
        .describe(
          "可选。当路由无法精确匹配到文件时（如动态路由 /user/123），可传关键词（多个用空格或逗号分隔），在页面目录中按路径包含关键词查找对应源码",
        ),
    },
  },
  async ({ routePath, projectRoot, keyword }) => {
    const root = path.resolve(projectRoot || DEFAULT_PROJECT_ROOT);
    const candidatePaths = await resolveRouteToFilePaths(routePath, root);
    let foundPath = await findFirstExistingFile(candidatePaths);
    let sourceNote = "精确匹配";

    if (!foundPath) {
      const conventions = await detectConventions(root);
      const keywordMatches = await searchByKeyword(root, routePath, keyword, conventions);
      if (keywordMatches.length > 0) {
        foundPath = keywordMatches[0];
        sourceNote =
          keywordMatches.length > 1
            ? `按「路由+关键词」匹配（共 ${keywordMatches.length} 个候选，取最佳）：`
            : "按「路由+关键词」匹配：";
      }
    }

    if (!foundPath) {
      return {
        content: [
          {
            type: "text",
            text: `未找到路由 "${routePath}" 对应的页面源码文件。\n项目根目录：${root}\n尝试路径（部分）：\n${candidatePaths.slice(0, 20).map((p) => `  - ${p}`).join("\n")}${candidatePaths.length > 20 ? "\n  ..." : ""}\n可尝试传入 keyword 参数（如页面名称、菜单名），在页面目录中按关键词查找；动态路由（如 /user/123）会先过滤掉数字/ID 段再参与匹配。`,
          },
        ],
      };
    }

    const relativePath = path.relative(root, foundPath);
    return {
      content: [
        {
          type: "text",
          text: `路由 "${routePath}" 对应页面源码（${sourceNote}）：\n\n文件路径：${foundPath}\n相对路径：${relativePath}\n\n可在编辑器中直接打开上述路径进行编辑。`,
        },
      ],
    };
  },
);

// 使用标准输入/输出与 Client 通信（JSON-RPC 消息通过 stdin/stdout 收发）
const transport = new StdioServerTransport();
await server.connect(transport);
