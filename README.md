# Agent 学习项目

本仓库用于整理和存放 **AI Agent 开发** 相关学习笔记与代码练习，便于复习与查阅。

## 技术栈

- **运行时**：Node（ESM）
- **AI**：LangChain（单 Agent）、LangGraph（多 Agent，后续）
- **包管理**：pnpm（monorepo）
- **格式与校验**：oxfmt、oxlint

## 目录结构

```
agent-study/
  docs/                    # 学习笔记与总结
    1. Agent 开发要学什么.md
    2. 从 Tool 开始：让大模型自动调工具读文件.md
  chapter/
    2/
      tool-test/            # 第 2 章：Tool 示例（读文件）
        src/
          hello-langchain.mjs   # 简单对话
          loadEnv.mjs           # 根目录 .env 加载（公共）
          tool-file-read.mjs    # read_file Tool + 调用循环
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
   ```
3. `.env` 已加入 `.gitignore`，请勿提交。

## 常用脚本（根目录执行）

| 命令 | 说明 |
| --- | --- |
| `pnpm ch2` | 运行简单对话示例（hello-langchain） |
| `pnpm ch2:read` | 运行 Tool 示例：读文件并解释代码（tool-file-read） |
| `pnpm format` | 使用 oxfmt 格式化代码 |
| `pnpm format:check` | 仅检查格式（适合 CI） |
| `pnpm lint` | 使用 oxlint 做代码校验 |

也可进入 `chapter/2/tool-test` 后执行 `pnpm run dev`（默认跑 hello-langchain）。

## 文档列表

| 序号 | 主题 | 文件 |
| --- | --- | --- |
| 1 | Agent 开发要学什么 | [docs/1. Agent 开发要学什么.md](docs/1.%20Agent%20开发要学什么.md) |
| 2 | 从 Tool 开始：让大模型自动调工具读文件 | [docs/2. 从 Tool 开始：让大模型自动调工具读文件.md](docs/2.从%20Tool%20开始：让大模型自动调工具读文件.md) |

## 学习主线

围绕「给大模型扩展能力、开发 Agent」展开：

- **Memory**：记忆管理
- **Tool**：工具调用（读/写文件、执行命令等）
- **RAG**：文档/知识库查询

技术栈以 Node + LangChain + LangGraph 为主，后续会结合 Nest 做 AI 全栈。

## 备注

- 笔记来源于课程学习后的整理，侧重概念与主线。
- 依赖安装与更新统一使用 **pnpm**。
