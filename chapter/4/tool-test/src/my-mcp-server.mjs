/**
 * MCP Server 示例：基于 @modelcontextprotocol/sdk 实现的简易服务端。
 *
 * 功能：
 * - 注册 Tool：query_user，供 Cursor 等 MCP Client 调用以查询用户信息
 * - 注册 Resource：使用指南，供 Client 读取静态文档
 *
 * 运行方式：通常由 Cursor 等客户端通过 stdio 启动本进程并通信；
 * 也可用 npx @modelcontextprotocol/inspector 等工具调试。
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 内存中的模拟「数据库」，仅用于演示 Tool 的数据来源
const database = {
  users: {
    "001": { id: "001", name: "张三", email: "zhangsan@example.com", role: "admin" },
    "002": { id: "002", name: "李四", email: "lisi@example.com", role: "user" },
    "003": { id: "003", name: "王五", email: "wangwu@example.com", role: "user" },
  },
};

// 创建 MCP Server 实例，name/version 会暴露给 Client 用于识别
const server = new McpServer({
  name: "my-mcp-server",
  version: "1.0.0",
});

// 注册工具：查询用户信息
// - 第一个参数：工具名称，Client 通过此名称调用
// - 第二个参数：元数据，description 供模型理解用途，inputSchema 用 zod 描述参数（会转为 JSON Schema）
// - 第三个参数：实际执行函数，入参与 inputSchema 一致，返回 MCP 约定的 { content: [{ type, text }] } 格式
server.registerTool(
  "query_user",
  {
    description: "查询数据库中的用户信息。输入用户 ID，返回该用户的详细信息（姓名、邮箱、角色）。",
    inputSchema: {
      userId: z.string().describe("用户 ID，例如: 001, 002, 003"),
    },
  },
  async ({ userId }) => {
    const user = database.users[userId];

    if (!user) {
      return {
        content: [
          {
            type: "text",
            text: `用户 ID ${userId} 不存在。可用的 ID: 001, 002, 003`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `用户信息：\n- ID: ${user.id}\n- 姓名: ${user.name}\n- 邮箱: ${user.email}\n- 角色: ${user.role}`,
        },
      ],
    };
  },
);

// 注册资源：只读文档，Client 可通过 list resources + read resource 获取内容
// - 第一个参数：资源在列表中的显示名称
// - 第二个参数：资源 URI（如 docs://guide），Client 用此 URI 请求内容
// - 第三个参数：元数据，description、mimeType 等
// - 第四个参数：返回内容的异步函数，返回 { contents: [{ uri, mimeType, text }] }
server.registerResource(
  "使用指南",
  "docs://guide",
  {
    description: "MCP Server 使用文档",
    mimeType: "text/plain",
  },
  async () => {
    return {
      contents: [
        {
          uri: "docs://guide",
          mimeType: "text/plain",
          text: `MCP Server 使用指南
    
    功能：提供用户查询等工具。
    
    使用：在 Cursor 等 MCP Client 中通过自然语言对话，Cursor 会自动调用相应工具。`,
        },
      ],
    };
  },
);

// 使用标准输入/输出与 Client 通信（JSON-RPC 消息通过 stdin/stdout 收发）
const transport = new StdioServerTransport();
await server.connect(transport);
