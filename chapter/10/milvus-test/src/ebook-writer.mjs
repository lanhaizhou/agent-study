/**
 * 电子书入库示例：读取 EPUB → 按章节再按固定长度切块 → 向量化 → 写入 Milvus。
 *
 * 前置条件：
 * - 本机 Milvus（默认 localhost:19530）
 * - EPUB 文件：默认 `chapter/10/milvus-test/天龙八部.epub`（相对本文件用 `import.meta.url` 解析，与从何处执行 `pnpm ch10:ew` 无关）；也可设置环境变量 EPUB_PATH 覆盖
 * - .env：OPENAI_API_KEY、EMBEDDINGS_MODEL_NAME、OPENAI_BASE_URL（可选）；向量维度与建表 dim 一致
 *
 * 设计说明：
 * - 单集合 COLLECTION_NAME 存多本书时，用 book_id / book_name 区分；主键 id 由 book_id + 章节号 + 块序号拼成，避免重复插入冲突（若需重跑请先删数据或换 bookId）。
 * - EPubLoader(splitChapters: true) 得到「每章一篇」Document；再用 RecursiveCharacterTextSplitter 切成更小 chunk 以适配 embedding 与 VarChar 上限。
 */
import "dotenv/config";
import { dirname, join, parse } from "path";
import { fileURLToPath } from "url";
import { MilvusClient, DataType, MetricType, IndexType } from "@zilliz/milvus2-sdk-node";
import { OpenAIEmbeddings } from "@langchain/openai";
import { EPubLoader } from "@langchain/community/document_loaders/fs/epub";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

/** Milvus 集合名：本书所有 chunk 写入同一集合 */
const COLLECTION_NAME = "ebook_collection";

/**
 * 与 OpenAIEmbeddings.dimensions、FloatVector dim 一致。
 */
const VECTOR_DIM = 1024;

/**
 * 每块最大字符数（近似 token 控制需另算）；与 content 字段 max_length 配合，避免超长截断或入库失败。
 */
const CHUNK_SIZE = 500;

const __dirname = dirname(fileURLToPath(import.meta.url));

/** EPUB 绝对路径：默认在包目录 `milvus-test/天龙八部.epub`；可用 EPUB_PATH 指定任意路径 */
const EPUB_FILE = process.env.EPUB_PATH ?? join(__dirname, "..", "天龙八部.epub");

/** 从路径解析出的文件名（无扩展名），写入 book_name 便于检索展示 */
const BOOK_NAME = parse(EPUB_FILE).name;

/**
 * 与入库、检索脚本共用同一 embedding 配置，保证向量空间一致。
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
 * 单条文本 → 稠密向量，供 FloatVector 列存储。
 * @param {string} text 单块正文
 * @returns {Promise<number[]>}
 */
async function getEmbedding(text) {
  const result = await embeddings.embedQuery(text);
  return result;
}

/**
 * 若集合不存在则建表、建索引；最后尝试 load，便于后续 insert 后立刻 search（insert 本身不要求先 load）。
 *
 * @param {string|number} _bookId 业务侧书籍 ID（预留：按书分集合或校验时可使用；当前 ensure 逻辑与单本书无关）
 */
async function ensureCollection(_bookId) {
  try {
    const hasCollection = await client.hasCollection({
      collection_name: COLLECTION_NAME,
    });

    if (!hasCollection.value) {
      console.log("创建集合...");
      await client.createCollection({
        collection_name: COLLECTION_NAME,
        fields: [
          // 主键：自定义字符串，需全局唯一（本脚本用 bookId_章节_块序号）
          { name: "id", data_type: DataType.VarChar, max_length: 100, is_primary_key: true },
          { name: "book_id", data_type: DataType.VarChar, max_length: 100 },
          { name: "book_name", data_type: DataType.VarChar, max_length: 200 },
          // 章节序号：EPubLoader 顺序 + 1，与 EPUB  spine 顺序一致
          { name: "chapter_num", data_type: DataType.Int32 },
          // 本章内 chunk 序号，从 0 起
          { name: "index", data_type: DataType.Int32 },
          { name: "content", data_type: DataType.VarChar, max_length: 10000 },
          { name: "vector", data_type: DataType.FloatVector, dim: VECTOR_DIM },
        ],
      });
      console.log("✓ 集合创建成功");

      console.log("创建索引...");
      await client.createIndex({
        collection_name: COLLECTION_NAME,
        field_name: "vector",
        index_type: IndexType.IVF_FLAT,
        metric_type: MetricType.COSINE,
        params: { nlist: 1024 },
      });
      console.log("✓ 索引创建成功");
    }

    // 已存在集合时可能已被 load；再次 load 可能抛错，故吞掉异常仅打日志（生产环境可改为 getLoadState 再决定）
    try {
      await client.loadCollection({ collection_name: COLLECTION_NAME });
      console.log("✓ 集合已加载");
    } catch {
      console.log("✓ 集合已处于加载状态");
    }
  } catch (error) {
    console.error("创建集合时出错:", error.message);
    throw error;
  }
}

/**
 * 将同一章的多个文本块并行向量化后一次性 insert（Milvus 单次 insert 可多行）。
 *
 * @param {string[]} chunks 本章切分后的纯文本数组
 * @param {string|number} bookId 书籍 ID（写入 book_id 时会转成字符串）
 * @param {number} chapterNum 章节编号（本脚本为 1-based）
 * @returns {Promise<number>} 本次插入行数
 */
async function insertChunksBatch(chunks, bookId, chapterNum) {
  try {
    if (chunks.length === 0) {
      return 0;
    }

    const insertData = await Promise.all(
      chunks.map(async (chunk, chunkIndex) => {
        const vector = await getEmbedding(chunk);
        return {
          id: `${bookId}_${chapterNum}_${chunkIndex}`,
          book_id: String(bookId),
          book_name: BOOK_NAME,
          chapter_num: chapterNum,
          index: chunkIndex,
          content: chunk,
          vector: vector,
        };
      }),
    );

    const insertResult = await client.insert({
      collection_name: COLLECTION_NAME,
      data: insertData,
    });

    return Number(insertResult.insert_cnt) || 0;
  } catch (error) {
    console.error(`插入章节 ${chapterNum} 的数据时出错:`, error.message);
    console.error("错误详情:", error);
    throw error;
  }
}

/**
 * 流式处理：按章节读取 EPUB → 每章 splitText → 立刻 embedding + insert，降低峰值内存（相对「整书向量化再一次性插入」）。
 *
 * @param {string|number} bookId 写入 Milvus 的 book_id
 * @returns {Promise<number>} 全书累计插入条数
 */
async function loadAndProcessEPubStreaming(bookId) {
  try {
    console.log(`\n开始加载 EPUB 文件: ${EPUB_FILE}`);

    // splitChapters: true → 每个 spine 项一篇 Document，metadata 中可带章节信息（视 EPUB 结构而定）
    const loader = new EPubLoader(EPUB_FILE, {
      splitChapters: true,
    });

    const documents = await loader.load();
    console.log(`✓ 加载完成，共 ${documents.length} 个章节\n`);

    // chunkOverlap：相邻块共享尾部/头部字符，减轻切块边界的语义断裂
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: CHUNK_SIZE,
      chunkOverlap: 50,
    });

    let totalInserted = 0;
    for (let chapterIndex = 0; chapterIndex < documents.length; chapterIndex++) {
      const chapter = documents[chapterIndex];
      const chapterContent = chapter.pageContent;

      console.log(`处理第 ${chapterIndex + 1}/${documents.length} 章...`);

      const chunks = await textSplitter.splitText(chapterContent);

      console.log(`  拆分为 ${chunks.length} 个片段`);

      if (chunks.length === 0) {
        console.log(`  跳过空章节\n`);
        continue;
      }

      console.log(`  生成向量并插入中...`);
      // chapterIndex + 1：与常见「第几章」人类计数一致
      const insertedCount = await insertChunksBatch(chunks, bookId, chapterIndex + 1);
      totalInserted += insertedCount;

      console.log(`  ✓ 已插入 ${insertedCount} 条记录（累计: ${totalInserted}）\n`);
    }

    console.log(`\n总共插入 ${totalInserted} 条记录\n`);
    return totalInserted;
  } catch (error) {
    console.error("加载 EPUB 文件时出错:", error.message);
    throw error;
  }
}

async function main() {
  try {
    console.log("=".repeat(80));
    console.log("电子书处理程序");
    console.log("=".repeat(80));

    console.log("\n连接 Milvus...");
    await client.connectPromise;
    console.log("✓ 已连接\n");

    // 多书场景可改为 ISBN、UUID 等；与 id 前缀一致，重复跑脚本会主键冲突
    const bookId = 1;

    await ensureCollection(bookId);

    await loadAndProcessEPubStreaming(bookId);

    console.log("=".repeat(80));
    console.log("处理完成！");
    console.log("=".repeat(80));
  } catch (error) {
    console.error("\n错误:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
