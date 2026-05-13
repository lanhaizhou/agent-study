/**
 * 电子书 RAG：在 Milvus 集合 `ebook_collection` 中按问题向量检索 Top-K 文本块，再交给 LLM 生成关于《天龙八部》（或同库其他书）的回答。
 *
 * 前置条件：
 * - 已运行 `ebook-writer.mjs`（或等价逻辑）向 `ebook_collection` 写入带 `vector` 的 chunk；字段含 id、book_id、chapter_num、index、content 等，与下方 output_fields 一致
 * - 集合已建索引且可 load；Embeddings 模型与维度需与入库时一致（否则相似度不可靠）
 * - .env：OPENAI_API_KEY、MODEL_NAME、EMBEDDINGS_MODEL_NAME、OPENAI_BASE_URL（可选）
 * - 本机 Milvus：默认 localhost:19530
 */
import "dotenv/config";
import { MilvusClient, MetricType } from "@zilliz/milvus2-sdk-node";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";

/** 与 ebook-writer.mjs 中 COLLECTION_NAME 一致 */
const COLLECTION_NAME = "ebook_collection";

/**
 * 查询向量维度，必须与写入 Milvus 时 embedding 的 dimensions、FloatVector dim 一致。
 */
const VECTOR_DIM = 1024;

/**
 * 对话模型：根据检索到的原文片段归纳、回答用户问题。
 */
const model = new ChatOpenAI({
  temperature: 0.7,
  model: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

/**
 * 与入库脚本使用同一 embedding 端点与维度，保证问题向量与库内向量在同一空间。
 */
const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.EMBEDDINGS_MODEL_NAME,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
  dimensions: VECTOR_DIM,
});

const client = new MilvusClient({
  address: "localhost:19530",
});

/**
 * 将自然语言问题编码为稠密向量，用于 ANN 搜索。
 * @param {string} text 用户问题（或检索用语）
 * @returns {Promise<number[]>}
 */
async function getEmbedding(text) {
  const result = await embeddings.embedQuery(text);
  return result;
}

/**
 * 在电子书 chunk 集合上做向量检索。
 *
 * @param {string} question 用户问题
 * @param {number} [k=3] Top-K 条命中
 * @returns {Promise<Array>} Milvus `results`；每项含 score 与请求的 output_fields
 */
async function retrieveRelevantContent(question, k = 3) {
  try {
    const queryVector = await getEmbedding(question);

    // metric_type 需与建索引时一致（如 IVF_FLAT + COSINE）
    const searchResult = await client.search({
      collection_name: COLLECTION_NAME,
      vector: queryVector,
      limit: k,
      metric_type: MetricType.COSINE,
      // 与 ebook-writer 写入字段对齐；可按需增加 book_name、过滤 expr 等
      output_fields: ["id", "book_id", "chapter_num", "index", "content"],
    });

    return searchResult.results;
  } catch (error) {
    console.error("检索内容时出错:", error.message);
    return [];
  }
}

/**
 * RAG：检索 → 拼上下文 → 单条字符串 prompt 调用模型（演示用；生产可改为消息列表 + 引用编号防幻觉）。
 *
 * @param {string} question 用户问题
 * @param {number} [k=3] 检索条数
 * @returns {Promise<string>} 模型回答或固定错误提示文案
 */
async function answerEbookQuestion(question, k = 3) {
  try {
    console.log("=".repeat(80));
    console.log(`问题: ${question}`);
    console.log("=".repeat(80));

    console.log("\n【检索相关内容】");
    const retrievedContent = await retrieveRelevantContent(question, k);

    if (retrievedContent.length === 0) {
      console.log("未找到相关内容");
      return "抱歉，我没有找到相关的《天龙八部》内容。";
    }

    // 控制台只打印前 200 字，避免刷屏；送入 LLM 的 context 仍为完整片段
    retrievedContent.forEach((item, i) => {
      console.log(`\n[片段 ${i + 1}] 相似度: ${item.score.toFixed(4)}`);
      console.log(`书籍: ${item.book_id}`);
      console.log(`章节: 第 ${item.chapter_num} 章`);
      console.log(`片段索引: ${item.index}`);
      console.log(
        `内容: ${item.content.substring(0, 200)}${item.content.length > 200 ? "..." : ""}`,
      );
    });

    const context = retrievedContent
      .map((item, i) => {
        return `[片段 ${i + 1}]
        章节: 第 ${item.chapter_num} 章
        内容: ${item.content}`;
      })
      .join("\n\n━━━━━\n\n");

    const prompt = `你是一个专业的《天龙八部》小说助手。基于小说内容回答问题，用准确、详细的语言。

请根据以下《天龙八部》小说片段内容回答问题：
${context}

用户问题: ${question}

回答要求：
1. 如果片段中有相关信息，请结合小说内容给出详细、准确的回答
2. 可以综合多个片段的内容，提供完整的答案
3. 如果片段中没有相关信息，请如实告知用户
4. 回答要准确，符合小说的情节和人物设定
5. 可以引用原文内容来支持你的回答

AI 助手的回答:`;

    console.log("\n【AI 回答】");
    const response = await model.invoke(prompt);
    console.log(response.content);
    console.log("\n");

    return response.content;
  } catch (error) {
    console.error("回答问题时出错:", error.message);
    return "抱歉，处理您的问题时出现了错误。";
  }
}

/**
 * 连接 Milvus → load 集合 → 执行一次示例问答。
 * load：search 前需要集合处于已加载状态；若已加载，部分版本/驱动会报错，故用 try/catch 区分「已加载」与其它错误。
 */
async function main() {
  try {
    console.log("连接到 Milvus...");
    await client.connectPromise;
    console.log("✓ 已连接\n");

    try {
      await client.loadCollection({ collection_name: COLLECTION_NAME });
      console.log("✓ 集合已加载\n");
    } catch (error) {
      if (!error.message.includes("already loaded")) {
        throw error;
      }
      console.log("✓ 集合已处于加载状态\n");
    }

    await answerEbookQuestion("段誉会什么武功？", 5);
  } catch (error) {
    console.error("错误:", error.message);
  }
}

main();
