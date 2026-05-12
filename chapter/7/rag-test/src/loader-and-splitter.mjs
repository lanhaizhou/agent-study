/**
 * loader-and-splitter.mjs
 *
 * 演示 RAG 中「文档加载（Loader）」与「文档切分（Splitter）」的用法：
 * 1. Loader：从网页等来源加载原始文档（本例用 CheerioWebBaseLoader 抓取指定 URL 的 DOM 内容）
 * 2. Splitter：将长文档按语义/长度切分成小块，便于向量化与检索时控制粒度
 * 3. 切分后的 Document 向量化入库，再按问题做语义检索并拼进 prompt 生成回答
 */

import "dotenv/config";
import "cheerio";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";

// 大模型：根据「检索到的上下文 + 用户问题」生成最终回答
const model = new ChatOpenAI({
  temperature: 0,
  model: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

// 嵌入模型：将文本转为向量，用于构建向量库与查询时的相似度计算
const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.EMBEDDINGS_MODEL_NAME,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

// Loader：从网页加载文档。CheerioWebBaseLoader 会请求 URL，用 Cheerio 解析 HTML，再按 selector 抽取正文
// selector 指定要抽取的 DOM 选择器（如 ".main-area p" 表示主区域内的段落），合并为一个或多个 Document
const cheerioLoader = new CheerioWebBaseLoader("https://juejin.cn/post/7233327509919547452", {
  selector: ".main-area p",
});

const documents = await cheerioLoader.load();

// 本例中 loader 将整页选中内容合并为一个 Document；若需按段落/标题拆成多个，可换用其他 loader 或后续用 splitter 再切
console.assert(documents.length === 1);
console.log(`Total characters: ${documents[0].pageContent.length}`);

// Splitter：递归按分隔符切分长文本，避免单块过长导致向量化/检索效果差
// chunkSize：每块目标字符数上限；chunkOverlap：块与块之间重叠字符数，减少句子在边界被截断
// separators：按优先级尝试的分隔符（如句号、感叹号、问号），尽量在句子边界处切分，保持语义完整
const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 500,
  chunkOverlap: 50,
  separators: ["。", "！", "？"],
});

// 将 loader 得到的 documents 切分成多个小块，每个块仍是 Document（含 pageContent 与 metadata，metadata 会继承）
const splitDocuments = await textSplitter.splitDocuments(documents);

console.log(`文档分割完成，共 ${splitDocuments.length} 个分块\n`);

// 用切分后的文档构建向量库：每个小块单独向量化，检索时返回与问题最相关的若干块
console.log("正在创建向量存储...");
const vectorStore = await MemoryVectorStore.fromDocuments(splitDocuments, embeddings);
console.log("向量存储创建完成\n");

// 检索器：按问题向量检索最相关的 k 条文档块（k=2）
const retriever = vectorStore.asRetriever({ k: 2 });

const questions = ["父亲的去世对作者的人生态度产生了怎样的根本性逆转？"];

// RAG 流程：对每个问题做语义检索，将检索结果拼进 prompt，再调用大模型生成回答
for (const question of questions) {
  console.log("=".repeat(80));
  console.log(`问题: ${question}`);
  console.log("=".repeat(80));

  // 用问题做语义检索：将 question 向量化后与库中向量算相似度，返回最相关的 k 条 Document 块，作为后续拼进 prompt 的上下文
  const retrievedDocs = await retriever.invoke(question);

  // 带相似度评分的检索，用于打印：score 为距离，越小越相似；相似度可表示为 1 - score
  const scoredResults = await vectorStore.similaritySearchWithScore(question, 2);

  console.log("\n【检索到的文档及相似度评分】");
  retrievedDocs.forEach((doc, i) => {
    const scoredResult = scoredResults.find(
      ([scoredDoc]) => scoredDoc.pageContent === doc.pageContent,
    );
    const score = scoredResult ? scoredResult[1] : null;
    const similarity = score !== null ? (1 - score).toFixed(4) : "N/A";

    console.log(`\n[文档 ${i + 1}] 相似度: ${similarity}`);
    console.log(`内容: ${doc.pageContent}`);
    if (doc.metadata && Object.keys(doc.metadata).length > 0) {
      console.log(`元数据:`, doc.metadata);
    }
  });

  // 将检索到的文档块拼成上下文，插入 prompt，供大模型基于这些内容回答问题
  const context = retrievedDocs
    .map((doc, i) => `[片段${i + 1}]\n${doc.pageContent}`)
    .join("\n\n━━━━━\n\n");

  const prompt = `你是一个文章辅助阅读助手，根据文章内容来解答：

文章内容：
${context}

问题: ${question}

你的回答:`;

  console.log("\n【AI 回答】");
  const response = await model.invoke(prompt);
  console.log(response.content);
  console.log("\n");
}
