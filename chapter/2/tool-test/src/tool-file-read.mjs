/**
 * Tool 调用示例：让大模型通过 read_file 工具读取本地文件并解释代码。
 * 演示 LangChain 中「模型 -> 返回 tool_calls -> 执行工具 -> 把结果作为 ToolMessage 再调模型」的循环。
 */

import "./loadEnv.mjs";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import fs from "node:fs/promises";
import { z } from "zod";

// --- 大模型配置 ---
const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

// --- 定义工具：read_file ---
// tool( 执行函数, { name, description, schema } )：schema 用 zod 声明入参，供模型生成合规的 tool_calls
const readFileTool = tool(
  async ({ filePath }) => {
    const content = await fs.readFile(filePath, "utf-8");
    console.log(`  [工具调用] read_file("${filePath}") - 成功读取 ${content.length} 字节`);
    return `文件内容:\n${content}`;
  },
  {
    name: "read_file",
    description:
      "用此工具来读取文件内容。当用户要求读取文件、查看代码、分析文件内容时，调用此工具。输入文件路径（可以是相对路径或绝对路径）。",
    schema: z.object({
      filePath: z.string().describe("要读取的文件路径"),
    }),
  },
);

const tools = [readFileTool];
// 把工具绑定到模型，模型在回复时可以选择返回 tool_calls 而不是纯文本
const modelWithTools = model.bindTools(tools);

// --- 构造对话：系统提示 + 用户请求 ---
const messages = [
  new SystemMessage(`你是一个代码助手，可以使用工具读取文件并解释代码。
  工作流程：
  1. 用户要求读取文件时，立即调用 read_file 工具
  2. 等待工具返回文件内容
  3. 基于文件内容进行分析和解释

  可用工具：
  - read_file: 读取文件内容（使用此工具来获取文件内容）
  `),
  new HumanMessage("请读取 src/tool-file-read.mjs 文件内容并解释代码"),
];

// --- Tool 调用循环 ---
// 第一次调用：模型可能直接返回 tool_calls（要执行 read_file），而不是最终答案
let response = await modelWithTools.invoke(messages);

// 只要模型返回了 tool_calls，就执行工具、把结果作为 ToolMessage 追加、再调一次模型，直到模型不再请求工具
while (response.tool_calls?.length > 0) {
  const toolMessages = [];
  for (const tc of response.tool_calls) {
    const fn = tools.find((t) => t.name === tc.name);
    const result = fn ? await fn.invoke(tc.args) : `未知工具: ${tc.name}`;
    // 每个 tool call 对应一个 ToolMessage，tool_call_id 用于和模型返回的 tc.id 对应
    toolMessages.push(new ToolMessage({ content: String(result), tool_call_id: tc.id }));
  }
  // 把本轮的 AI 回复和工具结果都追加进 messages，再让模型基于完整上下文生成下一步
  messages.push(response);
  messages.push(...toolMessages);
  response = await modelWithTools.invoke(messages);
}

// 循环结束后，response 为不含 tool_calls 的最终回复，输出 content 即可
console.log(response.content);
