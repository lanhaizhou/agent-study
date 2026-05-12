/**
 * Milvus 向量库示例：创建集合、建索引、插入带 embedding 的「日记」数据，最后 load 以便后续 search/query。
 *
 * 前置条件：
 * - 本机已启动 Milvus（默认 gRPC 端口 19530）
 * - .env 中配置 OPENAI_API_KEY、EMBEDDINGS_MODEL_NAME、OPENAI_BASE_URL（若用兼容网关）
 *
 * 注意：若集合 COLLECTION_NAME 已存在，createCollection 会报错，需先在 Milvus 中删除该集合或改名称。
 */
import "dotenv/config";
import { MilvusClient, DataType, MetricType, IndexType } from "@zilliz/milvus2-sdk-node";
import { OpenAIEmbeddings } from "@langchain/openai";

/** Milvus 中的集合名，同一实例下唯一 */
const COLLECTION_NAME = "ai_diary";

/**
 * 向量维度，必须与 embedding 模型输出维度一致。
 * OpenAI 部分模型支持通过 dimensions 参数指定输出维度（需与模型能力匹配）。
 */
const VECTOR_DIM = 1024;

/**
 * LangChain OpenAI 兼容 Embeddings：对文本调用 API 得到 float 向量。
 * configuration.baseURL 可指向自建或第三方 OpenAI 兼容服务。
 */
const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.EMBEDDINGS_MODEL_NAME,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
  dimensions: VECTOR_DIM,
});

/** Milvus 客户端；address 为 host:port，对应 Milvus 的 gRPC 监听地址 */
const client = new MilvusClient({
  address: "localhost:19530",
});

/**
 * 将单条文本编码为稠密向量，供 FloatVector 字段存储与检索。
 * @param {string} text 待向量化的正文
 * @returns {Promise<number[]>} 长度为 VECTOR_DIM 的浮点数组
 */
async function getEmbedding(text) {
  const result = await embeddings.embedQuery(text);
  return result;
}

async function main() {
  try {
    console.log("Connecting to Milvus...");
    // SDK 在构造后异步建连，connectPromise 完成即表示连接就绪
    await client.connectPromise;
    console.log("✓ Connected\n");

    // ---------- 1. 定义 Schema 并创建集合 ----------
    // 主键 id：业务侧字符串 ID；vector：与 embedding 同维；其余为标量/数组标量便于过滤与展示
    console.log("Creating collection...");
    await client.createCollection({
      collection_name: COLLECTION_NAME,
      fields: [
        // 主键：可变长字符串，最大 50 字符
        { name: "id", data_type: DataType.VarChar, max_length: 50, is_primary_key: true },
        // 向量列：维度与 VECTOR_DIM、embedding 输出一致
        { name: "vector", data_type: DataType.FloatVector, dim: VECTOR_DIM },
        // 日记正文，用于展示与再次向量化（若需要）
        { name: "content", data_type: DataType.VarChar, max_length: 5000 },
        { name: "date", data_type: DataType.VarChar, max_length: 50 },
        { name: "mood", data_type: DataType.VarChar, max_length: 50 },
        // Milvus 2.x 数组类型：元素为 VarChar，最多 10 个标签，每个标签最长 50
        {
          name: "tags",
          data_type: DataType.Array,
          element_type: DataType.VarChar,
          max_capacity: 10,
          max_length: 50,
        },
      ],
    });
    console.log("Collection created");

    // ---------- 2. 在向量列上创建 ANN 索引 ----------
    // IVF_FLAT：倒排 + 平坦存储，适合中小规模；nlist 为聚类中心数，影响构建与查询 trade-off
    // COSINE：余弦相似度，适合已归一化或关注方向的语义向量
    console.log("\nCreating index...");
    await client.createIndex({
      collection_name: COLLECTION_NAME,
      field_name: "vector",
      index_type: IndexType.IVF_FLAT,
      metric_type: MetricType.COSINE,
      params: { nlist: 1024 },
    });
    console.log("Index created");

    // ---------- 3. 准备业务数据并批量插入 ----------
    // insert 不要求集合已 load；与 create_index 的先后顺序也可按官方多种合法流程编排
    console.log("\nInserting diary entries...");
    const diaryContents = [
      {
        id: "diary_001",
        content: "今天天气很好，去公园散步了，心情愉快。看到了很多花开了，春天真美好。",
        date: "2026-01-10",
        mood: "happy",
        tags: ["生活", "散步"],
      },
      {
        id: "diary_002",
        content: "今天工作很忙，完成了一个重要的项目里程碑。团队合作很愉快，感觉很有成就感。",
        date: "2026-01-11",
        mood: "excited",
        tags: ["工作", "成就"],
      },
      {
        id: "diary_003",
        content: "周末和朋友去爬山，天气很好，心情也很放松。享受大自然的感觉真好。",
        date: "2026-01-12",
        mood: "relaxed",
        tags: ["户外", "朋友"],
      },
      {
        id: "diary_004",
        content: "今天学习了 Milvus 向量数据库，感觉很有意思。向量搜索技术真的很强大。",
        date: "2026-01-12",
        mood: "curious",
        tags: ["学习", "技术"],
      },
      {
        id: "diary_005",
        content: "晚上做了一顿丰盛的晚餐，尝试了新菜谱。家人都说很好吃，很有成就感。",
        date: "2026-01-13",
        mood: "proud",
        tags: ["美食", "家庭"],
      },
    ];

    // 并行对每条 content 请求 embedding，再与标量字段合并为 Milvus 一行
    console.log("Generating embeddings...");
    const diaryData = await Promise.all(
      diaryContents.map(async (diary) => ({
        ...diary,
        vector: await getEmbedding(diary.content),
      })),
    );

    // insert 的 data 为「对象数组」，每对象键名与集合字段名一致
    const insertResult = await client.insert({
      collection_name: COLLECTION_NAME,
      data: diaryData,
    });
    // insert_cnt 为本次成功写入的行数
    console.log(`✓ Inserted ${insertResult.insert_cnt} records\n`);

    // ---------- 4. 将集合加载到内存（供后续 search/query；insert 本身不依赖此步）----------
    console.log("Loading collection...");
    await client.loadCollection({ collection_name: COLLECTION_NAME });
    console.log("Collection loaded\n");
  } catch (error) {
    console.error("Error:", error.message);
  }
}

main();
