/**
 * node-exec.mjs
 * 使用 Node.js 的 child_process.spawn 在子进程中执行 shell 命令，
 * 并将子进程的 stdio 继承到当前进程，实现类似在终端直接执行命令的效果。
 */

import { spawn } from "node:child_process";

// 要执行的完整命令字符串（可改为其他命令，如 "node -v"、"echo hello" 等）
// const command = "ls -la";
// const command = "node -v";
const command = 'echo -e "n\nn" | pnpm create vite react-todo-app --template react-ts';

// 子进程的工作目录：使用当前 Node 进程的当前工作目录
const cwd = process.cwd();

// 将命令字符串拆成「可执行名」和「参数数组」
// 例如 "ls -la" -> cmd="ls", args=["-la"]
const [cmd, ...args] = command.split(" ");

// 创建子进程并执行 cmd + args
const child = spawn(cmd, args, {
  cwd, // 在指定目录下执行
  stdio: "inherit", // 子进程的 stdin/stdout/stderr 直接继承到当前进程，输出实时显示在控制台
  shell: true, // 通过系统 shell 执行，可解析管道、重定向等 shell 语法
});

// 用于保存 spawn 失败或进程错误时的错误信息，供 close 时统一输出
let errorMsg = "";

// 监听子进程错误（如命令不存在、权限不足、spawn 失败等）
child.on("error", (error) => {
  errorMsg = error.message;
});

// 子进程退出时触发（无论正常结束还是异常退出）
child.on("close", (code) => {
  if (code === 0) {
    // 退出码 0 表示成功，当前进程也以 0 退出
    process.exit(0);
  } else {
    // 非零退出码表示失败；若有 error 事件中保存的信息则一并打印
    if (errorMsg) {
      console.error(`错误: ${errorMsg}`);
    }
    // 用子进程的退出码结束当前进程，若 code 为 null 则用 1
    process.exit(code || 1);
  }
});
