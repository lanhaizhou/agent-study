/**
 * 普通流式输出示例（无结构化解析）
 *
 * 与 model.invoke() 一次性返回完整回复不同，model.stream() 会按 token/片段
 * 逐步产出内容，适合长回答、降低首字延迟、或边生成边展示的场景。
 */

// 从 .env 加载 OPENAI_API_KEY、OPENAI_BASE_URL、MODEL_NAME 等（需在项目目录放置 .env）
import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";

// 使用 LangChain 的 OpenAI 兼容客户端；baseURL 可指向官方 API 或兼容网关（如国内转发）
const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0, // 流式演示用确定性输出，便于对比行为
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

const prompt = `详细介绍莫扎特的信息。`;

console.log("🌊 普通流式输出演示（无结构化）\n");

try {
  // stream() 返回 AsyncIterable：每个 yield 的 chunk 通常是 AIMessageChunk，含增量 content
  const stream = await model.stream(prompt);

  let fullContent = "";
  let chunkCount = 0;

  console.log("📡 接收流式数据:\n");

  // for await...of 消费异步迭代器；循环体可能在短时间内被调用很多次
  for await (const chunk of stream) {
    chunkCount++;
    // 非工具调用场景下，常见的是字符串或字符串数组形式的增量文本
    const content = chunk.content;
    fullContent += content;

    // 用 stdout.write 而非 console.log，避免每条片段都换行，实现「打字机」式连续输出
    process.stdout.write(content);
  }

  // 流结束后换行（上面 write 没有末尾 \n），再打印统计信息
  console.log(`\n\n✅ 共接收 ${chunkCount} 个数据块\n`);
  console.log(`📝 完整内容长度: ${fullContent.length} 字符`);
} catch (error) {
  // 网络、鉴权、模型名错误等都会在这里被捕获；生产环境可扩展为记录 stack 或重试
  console.error("\n❌ 错误:", error.message);
}
