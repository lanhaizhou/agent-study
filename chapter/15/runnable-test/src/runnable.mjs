/**
 * Runnable + Chain 示例：把「提示词 → 模型 → 解析器」串成一条可复用的执行链。
 *
 * 核心概念：
 * - LangChain 里许多对象（如 PromptTemplate、ChatOpenAI、各类 Parser）都实现了 Runnable 接口。
 * - Runnable 提供统一入口：invoke / stream / batch 等，便于组合与观测（日志、回调）。
 * - `.pipe(b)` 等价于「先跑当前 Runnable，再把输出作为下一节的输入」，从左到右数据流。
 */
import "dotenv/config";
// StructuredOutputParser：在 prompt 里注入格式说明，并把模型返回的文本解析成结构化对象
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

// ChatOpenAI：兼容 OpenAI 协议的聊天模型客户端（含自定义 baseURL，如阿里云百炼）
const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

/**
 * 用 zod 描述「希望模型最终产出什么形状的数据」。
 * - .describe() 会进入 StructuredOutputParser 生成的格式说明里，引导模型按字段语义输出。
 * - keywords 限制为长度 3 的字符串数组：与业务「恰好 3 个关键词」一致。
 */
const schema = z.object({
  translation: z.string().describe("翻译后的英文文本"),
  keywords: z.array(z.string()).length(3).describe("3个关键词"),
});

// 由 zod schema 生成 parser：负责 getFormatInstructions() 与 parse(模型原始文本)
const outputParser = StructuredOutputParser.fromZodSchema(schema);

/**
 * Prompt 模板：
 * - {text}：用户待翻译的中文。
 * - {format_instructions}：必须传入 outputParser.getFormatInstructions()，
 *   这样模型才知道要按 JSON（等）结构返回，parser 才能 parse。
 */
const promptTemplate = PromptTemplate.fromTemplate(
  "将以下文本翻译成英文，然后总结为3个关键词。\n\n文本：{text}\n\n{format_instructions}",
);

/**
 * 链的两种等价写法（二选一即可）：
 *
 * import { RunnableSequence } from "@langchain/core/runnables";
 * const chain = RunnableSequence.from([promptTemplate, model, outputParser]);
 * - 显式数组，适合步骤多、需要一眼看清「流水线有几段」时。
 *
 * promptTemplate.pipe(model).pipe(outputParser)
 * - 链式 API，与 from 数组完全等价：上一步输出类型需与下一步输入兼容。
 *
 * 数据流简述：
 * 1) promptTemplate.invoke → 字符串 prompt（已替换 {text}、{format_instructions}）
 * 2) model.invoke → AIMessage（或等价结构），parser 会取其中的文本 content
 * 3) outputParser.invoke → 解析后的 { translation, keywords } 对象
 */
// const chain = RunnableSequence.from([promptTemplate, model, outputParser]);

const chain = promptTemplate.pipe(model).pipe(outputParser);

/**
 * 整条链的一次性入参：对象里每个 key 对应 prompt 里仍存在的占位符。
 * - format_instructions：运行时注入，保证与当前 outputParser 的规则一致（不要手写死格式说明）。
 */
const input = {
  text: "LangChain 是一个强大的 AI 应用开发框架",
  format_instructions: outputParser.getFormatInstructions(),
};

// invoke：非流式、单次执行，返回链最后一环的输出（此处为解析后的结构化对象）
const result = await chain.invoke(input);

console.log("✅ 最终结果:");
console.log(result);
