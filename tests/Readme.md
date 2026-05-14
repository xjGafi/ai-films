# 测试指南

## 目录结构

```
src/tests/
├── fixtures/              # 测试数据
│   ├── film.json          # parse 命令生成的完整配置
│   └── story.txt          # 示例故事文本
├── pipeline.test.ts       # 完整流程测试（需要 VOLC_API_KEY）
├── poll-task.test.ts      # 轮询逻辑测试（mock，不需要 API）
└── Readme.md
```

## 前置条件

1. 在项目根目录创建 `.env` 文件：
```
VOLC_API_KEY=your-key-here
```

2. 确保 `ffmpeg` 和 `ffprobe` 在系统 PATH 中：
```bash
brew install ffmpeg
```

## 运行测试

```bash
# 跑全部测试
pnpm test

# 只跑流程测试
pnpm test -- pipeline

# 只跑轮询测试
pnpm test -- poll-task

# watch 模式（文件变化自动重跑）
pnpm test:watch
```

## 测试说明

### pipeline.test.ts

验证完整 pipeline 流程，需要 `VOLC_API_KEY`：

- **从 JSON 配置跑全流程** — 读取 `fixtures/film.sample.json`，创建项目，逐 stage 执行，验证产物
- **从 TXT 跑全流程** — 读取 `fixtures/story.txt`，解析后创建项目并执行
- **从指定 stage 恢复** — 验证 `fromStage` 参数能从中间恢复执行
- **重试失败 stage** — 模拟失败后重跑，验证恢复

单次全流程测试耗时约 20-40 分钟（主要在视频生成阶段）。

### poll-task.test.ts

测试视频任务响应解析逻辑，使用 mock 数据，不调用真实 API：

- 各种成功/失败状态的识别
- 嵌套响应格式的解析
- HTTP 错误处理
- Authorization header 验证

## 常见问题

**Q: video-gen 阶段超时怎么办？**

Seedance 视频生成可能需要 5-10 分钟/片段。超时后可从该阶段重跑：
```bash
pnpm run dev run <project-id> --from video-gen
```

**Q: 如何查询视频任务进度？**

poll-task.test.ts 中的 `parseTaskResponse` 函数可以解析任务状态。也可以直接用 CLI：
```bash
pnpm run dev status <project-id>
```
