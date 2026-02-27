/**
 * LangChain + MCP 联调示例：让大模型通过 MCP 调用本地 MCP Server 提供的工具。
 *
 * 流程：
 * 1. 使用 MultiServerMCPClient 连接已配置的 MCP Server（如 my-mcp-server）
 * 2. 通过 getTools() 将 MCP 的 tools 转为 LangChain 的 tool 列表
 * 3. model.bindTools(tools) 后，模型在对话中可决定调用哪些工具
 * 4. 与 chapter 2/3 的 Tool 循环一致：invoke -> 若有 tool_calls 则执行并追加 ToolMessage -> 再 invoke
 *
 * 依赖：@langchain/mcp-adapters、@langchain/openai、@langchain/core；需先启动或可被子进程启动的 MCP Server。
 * 运行：node src/langchain-mcp-test.mjs（需在 chapter/4/tool-test 下或配置好 cwd）
 */

import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { ChatOpenAI } from "@langchain/openai";
import chalk from "chalk";
import { HumanMessage, ToolMessage, SystemMessage } from "@langchain/core/messages";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 大模型：用于理解用户问题并决定调用哪些 MCP 工具
const model = new ChatOpenAI({
  modelName: "qwen-plus",
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

// 多 MCP Server 客户端：可同时配置多个 Server，key 为 Server 名称，value 为 { command, args }
// 此处仅配置 my-mcp-server，通过 node 启动同目录下的 my-mcp-server.mjs，便于本地联调
const mcpClient = new MultiServerMCPClient({
  mcpServers: {
    "my-mcp-server": {
      command: "node",
      args: [path.join(__dirname, "my-mcp-server.mjs")],
    },
  },
});

// 将 MCP Server 暴露的 tools 拉取为 LangChain 可用的 tool 列表，并绑定到模型
const tools = await mcpClient.getTools();
const modelWithTools = model.bindTools(tools);

/**
 * 带工具调用的 Agent 循环
 * @param {string} query - 用户问题
 * @param {number} maxIterations - 最大轮数，防止无限循环
 * @returns {Promise<string>} 最后一轮模型的文字回复
 */
async function runAgentWithTools(query, maxIterations = 30) {
  const messages = [new SystemMessage(resourceContent), new HumanMessage(query)];

  for (let i = 0; i < maxIterations; i++) {
    console.log(chalk.bgGreen(`正在等待 AI 思考...`));
    const response = await modelWithTools.invoke(messages);
    messages.push(response);

    // 无 tool_calls 表示模型已给出最终回答，结束循环
    if (!response.tool_calls || response.tool_calls.length === 0) {
      console.log(`\nAI 最终回复:\n${response.content}\n`);
      return response.content;
    }

    console.log(chalk.bgBlue(`检测到 ${response.tool_calls.length} 个工具调用`));
    console.log(chalk.bgBlue(`工具调用: ${response.tool_calls.map((t) => t.name).join(", ")}`));
    // 按 tool_calls 逐个执行，将结果封装为 ToolMessage 并追加到 messages，供下一轮模型使用
    for (const toolCall of response.tool_calls) {
      const foundTool = tools.find((t) => t.name === toolCall.name);
      if (foundTool) {
        const toolResult = await foundTool.invoke(toolCall.args);
        messages.push(
          new ToolMessage({
            content: toolResult,
            tool_call_id: toolCall.id,
          }),
        );
      }
    }
  }

  return messages[messages.length - 1].content;
}

const res = await mcpClient.listResources();
// console.log(res);
// for (const [serverName, resources] of Object.entries(res)) {
//   for (const resource of resources) {
//     const content = await mcpClient.readResource(serverName, resource.uri);
//     console.log(content);
//   }
// }
let resourceContent = "";
for (const [serverName, resources] of Object.entries(res)) {
  for (const resource of resources) {
    const content = await mcpClient.readResource(serverName, resource.uri);
    resourceContent += content[0].text;
  }
}

// 示例：让模型根据自然语言「查一下用户 002 的信息」自动调用 my-mcp-server 的 query_user 工具
// await runAgentWithTools("查一下用户 002 的信息");
await runAgentWithTools("MCP Server 的使用指南是什么");

// 退出进程，关闭 MCP Server
await mcpClient.close();
