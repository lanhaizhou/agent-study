# Agent 学习项目

本仓库用于整理和存放 **AI Agent 开发** 相关学习笔记与代码练习，便于复习与查阅。

## 技术栈

- **运行时**：Node（ESM）
- **AI**：LangChain（单 Agent）、LangGraph（多 Agent，后续）
- **Tool 协议**：MCP（Model Context Protocol，跨进程调用）
- **包管理**：pnpm（monorepo）
- **格式与校验**：oxfmt、oxlint

## 目录结构

```
agent-study/
  docs/                    # 学习笔记与总结
    1. Agent 开发要学什么.md
    2. 从 Tool 开始：让大模型自动调工具读文件.md
    3. 实现 mini cursor：大模型自动调用 tool 执行命令.md
    4. MCP：可跨进程调用的 Tool.md
    5. 高德 MCP + 浏览器 MCP：LangChain 复用别人的 MCP Server 有多爽！.md
    6. RAG：把文档向量化，基于向量实现真正的语义搜索.md
  chapter/
    2/
      tool-test/            # 第 2 章：Tool 示例（读文件）
        src/
          hello-langchain.mjs
          loadEnv.mjs
          tool-file-read.mjs    # read_file Tool + 调用循环
    3/
      tool-test/            # 第 3 章：mini cursor（多 Tool）
        src/
          loadEnv.mjs
          all-tools.mjs         # read_file / write_file / execute_command / list_directory
          mini-cursor.mjs       # Agent 循环：根据 prompt 创建项目、装依赖、跑服务
          node-exec.mjs         # spawn 执行命令示例
          tool-file-read.mjs
    4/
      tool-test/            # 第 4 章：MCP（跨进程 Tool）
        src/
          langchain-mcp-test.mjs  # LangChain 调用 MCP 工具示例
          my-mcp-server.mjs       # 自定义 MCP 服务
          route-to-file-mcp.mjs   # 路由到文件的 MCP 封装
    5/
      tool-test/            # 第 5 章：复用他人 MCP（高德、FileSystem、Chrome DevTools）
        src/
          mcp-test.mjs            # 多 MCP Server 配置与 Agent 循环
    6/
      rag-test/             # 第 6 章：RAG（向量检索 + 增强生成）
        src/
          hello-rag.mjs           # 文档向量化、相似度检索、拼 prompt 生成回答
  .env                     # API 等环境变量（不提交，见下方）
  pnpm-workspace.yaml
  package.json             # 根脚本与公共依赖
```

## 环境准备

1. 安装依赖（需使用 pnpm）：
   ```bash
   pnpm install
   ```
2. 在项目根目录新建 `.env`，配置大模型 API（参考 [docs/2. 从 Tool 开始：让大模型自动调工具读文件.md](docs/2.从%20Tool%20开始：让大模型自动调工具读文件.md) 中的「在百炼控制台获取并设置 API Key」）：
   ```
   OPENAI_API_KEY=你的 API Key
   OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
   MODEL_NAME=qwen-coder-turbo
   # 第 6 章 RAG 需配置嵌入模型（可与 MODEL_NAME 不同）
   EMBEDDINGS_MODEL_NAME=text-embedding-v3
   ```
3. `.env` 已加入 `.gitignore`，请勿提交。

## 常用脚本（根目录执行）

| 命令 | 说明 |
| --- | --- |
| `pnpm ch2` | 运行简单对话示例（hello-langchain） |
| `pnpm ch2:read` | 运行 Tool 示例：读文件并解释代码（tool-file-read） |
| `pnpm ch3:exec` | 运行 spawn 执行命令示例（node-exec） |
| `pnpm ch3:miniCursor` | 运行 mini cursor：多 Tool Agent（创建项目、写文件、装依赖、跑服务） |
| `pnpm ch4:mcp` | 运行 MCP 示例：LangChain 调用 MCP 工具 |
| `pnpm ch5:mcp` | 运行多 MCP 示例：高德 / FileSystem / Chrome DevTools 等 |
| `pnpm ch6:rag` | 运行 RAG 示例：向量检索 + 增强 prompt 生成回答 |
| `pnpm format` | 使用 oxfmt 格式化代码 |
| `pnpm format:check` | 仅检查格式（适合 CI） |
| `pnpm lint` | 使用 oxlint 做代码校验 |

也可进入对应 `chapter/N/tool-test` 或 `chapter/6/rag-test` 后执行 `pnpm run dev`（以该章入口为准）。

## 文档列表

| 序号 | 主题 | 文件 |
| --- | --- | --- |
| 1 | Agent 开发要学什么 | [docs/1. Agent 开发要学什么.md](docs/1.%20Agent%20开发要学什么.md) |
| 2 | 从 Tool 开始：让大模型自动调工具读文件 | [docs/2.从 Tool 开始：让大模型自动调工具读文件.md](docs/2.从%20Tool%20开始：让大模型自动调工具读文件.md) |
| 3 | 实现 mini cursor：大模型自动调用 tool 执行命令 | [docs/3. 实现 mini cursor：大模型自动调用 tool 执行命令.md](docs/3.%20实现%20mini%20cursor：大模型自动调用%20tool%20执行命令.md) |
| 4 | MCP：可跨进程调用的 Tool | [docs/4. MCP：可跨进程调用的 Tool.md](docs/4.%20MCP：可跨进程调用的%20Tool.md) |
| 5 | 高德 MCP + 浏览器 MCP：LangChain 复用别人的 MCP Server | [docs/5. 高德 MCP + 浏览器 MCP：LangChain 复用别人的 MCP Server 有多爽！.md](docs/5.%20高德%20MCP%20+%20浏览器%20MCP：LangChain%20复用别人的%20MCP%20Server%20有多爽！.md) |
| 6 | RAG：把文档向量化，基于向量实现真正的语义搜索 | [docs/6. RAG：把文档向量化，基于向量实现真正的语义搜索.md](docs/6.%20RAG：把文档向量化，基于向量实现真正的语义搜索.md) |

## 学习主线

围绕「给大模型扩展能力、开发 Agent」展开：

- **Memory**：记忆管理
- **Tool**：工具调用（读/写文件、执行命令等）
- **RAG**：文档/知识库查询

技术栈以 Node + LangChain + LangGraph 为主，后续会结合 Nest 做 AI 全栈。

## 备注

- 笔记来源于课程学习后的整理，侧重概念与主线。
- 依赖安装与更新统一使用 **pnpm**。
