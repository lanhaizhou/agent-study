/**
 * 基于 Milvus 的简易 RAG：用用户问题做向量检索，取 Top-K 条日记作上下文，再交给 LLM 生成回答。
 *
 * 前置条件：
 * - Milvus 已运行，且存在集合 COLLECTION_NAME（字段含 vector、content、date、mood、tags 等，与 insert 脚本一致）
 * - 集合已建索引并 load，否则 search 会失败
 * - .env：OPENAI_API_KEY、OPENAI_BASE_URL（可选）、MODEL_NAME、EMBEDDINGS_MODEL_NAME；向量维度需与入库时一致
 */
import "dotenv/config";
import { MilvusClient, MetricType } from "@zilliz/milvus2-sdk-node";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";

/** 与 insert.mjs 写入的集合名一致 */
const COLLECTION_NAME = "ai_diary";

/**
 * 查询向量维度，必须与建集合时 FloatVector 的 dim、以及 Embeddings 的 dimensions 一致。
 */
const VECTOR_DIM = 1024;

/**
 * LangChain 对话模型：根据检索到的日记上下文生成自然语言回答。
 * temperature 控制随机性；baseURL 可指向兼容 OpenAI 的网关。
 */
const model = new ChatOpenAI({
  temperature: 0.7, //  温度调高，让 ai 生成更丰富的回答
  model: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

/**
 * 与 insert 使用同一套 Embeddings 配置，保证问题向量与库内向量在同一语义空间，
 * 且 metric（如 COSINE）与建索引时一致才有可比性。
 */
const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.EMBEDDINGS_MODEL_NAME,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
  dimensions: VECTOR_DIM,
});

/** Milvus gRPC 地址，需与 insert.mjs 相同实例 */
const client = new MilvusClient({
  address: "localhost:19530",
});

/**
 * 将自然语言编码为稠密向量，用于与 collection 中的 vector 列做相似度检索。
 * @param {string} text 问题或任意待检索文本
 * @returns {Promise<number[]>} 与 VECTOR_DIM 一致的浮点向量
 */
async function getEmbedding(text) {
  const result = await embeddings.embedQuery(text);
  return result;
}

/**
 * 向量检索：用问题 embedding 在 Milvus 中查最相近的 k 条实体（日记）。
 *
 * @param {string} question 用户问题
 * @param {number} [k=2] 返回条数上限（Top-K）
 * @returns {Promise<Array>} Milvus 返回的 results 数组；每项含 score 与 output_fields 中的标量字段
 */
async function retrieveRelevantDiaries(question, k = 2) {
  try {
    const queryVector = await getEmbedding(question);

    // ANN 搜索：未指定 partition / expr 时在全表检索；metric_type 需与建索引时一致（此处 COSINE）
    const searchResult = await client.search({
      collection_name: COLLECTION_NAME,
      // 单查询向量；也可传多行做批量检索
      vector: queryVector,
      limit: k,
      metric_type: MetricType.COSINE,
      // 除主键与向量外，需要带回的标量列（便于拼上下文与日志展示）
      output_fields: ["id", "content", "date", "mood", "tags"],
    });

    // SDK 将命中行放在 results 中；score 越大（对 COSINE 通常为相似度）越相关，具体含义以 Milvus 版本文档为准
    return searchResult.results;
  } catch (error) {
    console.error("检索日记时出错:", error.message);
    return [];
  }
}

/**
 * RAG 主流程：Retrieve（Milvus）→ Augment（拼 context + prompt）→ Generate（ChatOpenAI）。
 *
 * @param {string} question 用户问题
 * @param {number} [k=2] 检索条数
 * @returns {Promise<string>} 模型回答文本；失败或无命中时返回固定提示字符串
 */
async function answerDiaryQuestion(question, k = 2) {
  try {
    console.log("=".repeat(80));
    console.log(`问题: ${question}`);
    console.log("=".repeat(80));

    console.log("\n【检索相关日记】");
    const retrievedDiaries = await retrieveRelevantDiaries(question, k);

    if (retrievedDiaries.length === 0) {
      console.log("未找到相关日记");
      return "抱歉，我没有找到相关的日记内容。";
    }

    // 控制台打印命中结果，便于调试 RAG 是否召回到正确片段
    retrievedDiaries.forEach((diary, i) => {
      console.log(`\n[日记 ${i + 1}] 相似度: ${diary.score.toFixed(4)}`);
      console.log(`日期: ${diary.date}`);
      console.log(`心情: ${diary.mood}`);
      console.log(`标签: ${diary.tags?.join(", ")}`);
      console.log(`内容: ${diary.content}`);
    });

    // 将多条日记压成一块「证据」文本，供 LLM 只做归纳与回答，避免模型编造库外内容（仍可能幻觉，需产品层约束）
    const context = retrievedDiaries
      .map((diary, i) => {
        return `[日记 ${i + 1}]
        日期: ${diary.date}
        心情: ${diary.mood}
        标签: ${diary.tags?.join(", ")}
        内容: ${diary.content}`;
      })
      .join("\n\n━━━━━\n\n");

    // 明确角色、证据边界与用户问题，减少离题；生产环境可改为 ChatPromptTemplate / 消息列表以便多轮
    const prompt = `你是一个温暖贴心的 AI 日记助手。基于用户的日记内容回答问题，用亲切自然的语言。
        
        请根据以下日记内容回答问题：
        ${context}
        
        用户问题: ${question}

        回答要求：
1. 如果日记中有相关信息，请结合日记内容给出详细、温暖的回答
2. 可以总结多篇日记的内容，找出共同点或趋势
3. 如果日记中没有相关信息，请温和地告知用户
4. 用第一人称"你"来称呼日记的作者
5. 回答要有同理心，让用户感到被理解和关心

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

/** 脚本入口：连接 Milvus 后执行一次示例问答 */
async function main() {
  try {
    console.log("连接到 Milvus...");
    await client.connectPromise;
    console.log("✓ 已连接\n");
    await answerDiaryQuestion("我最近做了什么让我感到快乐的事情？", 2);
  } catch (error) {
    console.error("错误:", error.message);
  }
}

main();
