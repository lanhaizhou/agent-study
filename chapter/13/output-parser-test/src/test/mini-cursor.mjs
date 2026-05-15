/**
 * mini-cursor：流式 Agent + 工具调用（教学向「迷你 Cursor」）
 *
 * 流程概览：
 * 1. 用 SystemMessage 约定角色、工作目录与工具使用规范；HumanMessage 承载用户任务。
 * 2. 每轮迭代：把当前 history 交给已 bindTools 的模型，stream 消费 AIMessageChunk。
 * 3. 流式阶段一边 concat 出完整 AIMessage，一边用 JsonOutputToolsParser 尝试从「未写完的
 *    tool_calls JSON」里解析出结构化参数；若识别到 write_file 且 args.content 在增长，
 *    则把新增片段写到终端（类似 IDE 里看生成代码的体感）。
 * 4. 流结束后将完整 AIMessage 写回 history；若有 tool_calls 则逐个 invoke 工具，
 *    把结果用 ToolMessage 追加，再进入下一轮；若无工具调用则视为最终回答并返回。
 *
 * 依赖：仓库内 chapter/3/tool-test/src/all-tools.mjs 中的 read/write/exec/list（相对本文件 ../../../../3/tool-test/src/all-tools.mjs）；环境变量与 ChatOpenAI 配置同其他章节脚本。
 */

import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { JsonOutputToolsParser } from "@langchain/core/output_parsers/openai_tools";
import {
  executeCommandTool,
  listDirectoryTool,
  readFileTool,
  writeFileTool,
} from "../../../../3/tool-test/src/all-tools.mjs";
import chalk from "chalk";

// OpenAI 兼容接口；此处写死 qwen-plus，可按需改为 process.env.MODEL_NAME
const model = new ChatOpenAI({
  modelName: "qwen-plus",
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

// 与 all-tools 中 name 一致；顺序不影响 bind，但执行时按 fullAIMessage.tool_calls 顺序来
const tools = [readFileTool, writeFileTool, executeCommandTool, listDirectoryTool];

// 在请求体里带上 tools 定义，模型才能返回 tool_calls（函数调用）结构
const modelWithTools = model.bindTools(tools);

/**
 * 带工具的多轮 Agent 循环（流式展示 + 工具执行）
 *
 * @param {string} query - 用户任务（自然语言）
 * @param {number} [maxIterations=30] - 防止死循环的上限；每轮 = 一次模型回复 + 可选多次工具
 */
async function runAgentWithTools(query, maxIterations = 30) {
  // 内存会话：不持久化；生产可换 Redis、DB 等
  const history = new InMemoryChatMessageHistory();

  await history.addMessage(
    new SystemMessage(`你是一个项目管理助手，使用工具完成任务。

当前工作目录: ${process.cwd()}

工具：
1. read_file: 读取文件
2. write_file: 写入文件
3. execute_command: 执行命令（支持 workingDirectory 参数）
4. list_directory: 列出目录

重要规则 - execute_command：
- workingDirectory 参数会自动切换到指定目录
- 当使用 workingDirectory 时，绝对不要在 command 中使用 cd
- 错误示例: { command: "cd react-todo-app && pnpm install", workingDirectory: "react-todo-app" }
- 正确示例: { command: "pnpm install", workingDirectory: "react-todo-app" }

重要规则 - write_file：
- 当写入 React 组件文件（如 App.tsx）时，如果存在对应的 CSS 文件（如 App.css），在其他 import 语句后加上这个 css 的导入
`),
  );

  await history.addMessage(new HumanMessage(query));

  for (let i = 0; i < maxIterations; i++) {
    console.log(chalk.bgGreen(`⏳ 正在等待 AI 思考...`));

    // 每轮都把完整对话发给模型（含上轮 ToolMessage，形成 ReAct 式闭环）
    const messages = await history.getMessages();

    const rawStream = await modelWithTools.stream(messages);

    // 流式片段逐个 concat，得到与 invoke 等价的完整 AIMessage（含 tool_calls 字段）
    let fullAIMessage = null;

    // 从「仍在生成的」tool_calls 参数 JSON 中做增量解析；不完整时会 parse 抛错，捕获后跳过即可
    const toolParser = new JsonOutputToolsParser();

    // 每个 write_file 调用按 id 或路径记录已打印的 content 长度，只 stdout 新增后缀（流式预览）
    const printedLengths = new Map();

    console.log(chalk.bgBlue(`\n🚀 Agent 开始思考并生成流...\n`));

    for await (const chunk of rawStream) {
      // LangChain 约定：AIMessageChunk.concat 合并 tool_calls、content 等增量字段
      fullAIMessage = fullAIMessage ? fullAIMessage.concat(chunk) : chunk;

      let parsedTools = null;
      try {
        // parseResult 接收「当前累积消息」；随着流进行，JSON 从不完整到完整
        parsedTools = await toolParser.parseResult([{ message: fullAIMessage }]);
      } catch (e) {
        // 解析失败说明 JSON 还不完整，忽略错误继续累积
      }

      if (parsedTools && parsedTools.length > 0) {
        for (const toolCall of parsedTools) {
          // 仅对 write_file 的 content 做打字机效果；读文件/列目录等无长文本参数可预览
          if (toolCall.type === "write_file" && toolCall.args?.content) {
            const toolCallId = toolCall.id || toolCall.args.filePath || "default";
            const currentContent = String(toolCall.args.content);
            const previousLength = printedLengths.get(toolCallId);

            if (previousLength === undefined) {
              printedLengths.set(toolCallId, 0);
              console.log(
                chalk.bgBlue(
                  `\n[工具调用] write_file("${toolCall.args.filePath}") - 开始写入（流式预览）\n`,
                ),
              );
            }

            if (currentContent.length > previousLength) {
              const newContent = currentContent.slice(previousLength);
              process.stdout.write(newContent);
              printedLengths.set(toolCallId, currentContent.length);
            }
          }
        }
      } else {
        // 尚未形成可解析的工具调用结构时，先把模型的普通文本 content 直接打出（思考过程/说明）
        if (chunk.content) {
          process.stdout.write(
            typeof chunk.content === "string" ? chunk.content : JSON.stringify(chunk.content),
          );
        }
      }
    }

    // 流结束：fullAIMessage 与一次性 invoke 结果一致，写入历史供下一轮或结束判断
    await history.addMessage(fullAIMessage);
    console.log(chalk.green("\n✅ 消息已完整存入历史"));

    // 无工具调用：模型认为任务已用文字回答完毕
    if (!fullAIMessage.tool_calls || fullAIMessage.tool_calls.length === 0) {
      console.log(`\n✨ AI 最终回复:\n${fullAIMessage.content}\n`);
      return fullAIMessage.content;
    }

    // 按模型给出的 tool_calls 执行；id 用于 ToolMessage.tool_call_id 与 API 对齐
    for (const toolCall of fullAIMessage.tool_calls) {
      const foundTool = tools.find((t) => t.name === toolCall.name);
      if (foundTool) {
        const toolResult = await foundTool.invoke(toolCall.args);
        await history.addMessage(
          new ToolMessage({
            content: toolResult,
            tool_call_id: toolCall.id,
          }),
        );
      }
    }
  }

  // 达到 maxIterations 仍未返回：取最后一条消息内容作为兜底（避免 undefined）
  const finalMessages = await history.getMessages();
  return finalMessages[finalMessages.length - 1].content;
}

// 演示用复杂任务：创建 Vite 项目、改 App、样式与动画、pnpm 安装与 dev（实际执行依赖 all-tools 权限）
const case1 = `创建一个功能丰富的 React TodoList 应用：

1. 创建项目：echo -e "n\nn" | pnpm create vite react-todo-app --template react-ts
2. 修改 src/App.tsx，实现完整功能的 TodoList：
 - 添加、删除、编辑、标记完成
 - 分类筛选（全部/进行中/已完成）
 - 统计信息显示
 - localStorage 数据持久化
3. 添加复杂样式：
 - 渐变背景（蓝到紫）
 - 卡片阴影、圆角
 - 悬停效果
4. 添加动画：
 - 添加/删除时的过渡动画
 - 使用 CSS transitions
5. 列出目录确认

注意：使用 pnpm，功能要完整，样式要美观，要有动画效果

去掉 main.tsx 里的 index.css 导入

之后在 react-todo-app 项目中：
1. 使用 pnpm install 安装依赖
2. 使用 pnpm run dev 启动服务器
`;

try {
  await runAgentWithTools(case1);
} catch (error) {
  console.error(`\n❌ 错误: ${error.message}\n`);
}
