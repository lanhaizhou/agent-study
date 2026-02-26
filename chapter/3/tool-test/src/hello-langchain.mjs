import "./loadEnv.mjs";
import { ChatOpenAI } from "@langchain/openai";

// 使用兼容 OpenAI 的接口（如 DashScope），通过环境变量配置
const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

// 单轮对话：传入用户消息，取返回的 content 输出
const response = await model.invoke("介绍下自己");
console.log(response.content);
