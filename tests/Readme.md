# 测试指南

## 目录结构

```
tests/
├── fixtures/              # 测试数据（按编号目录组织）
│   ├── 01/                # ACE销售故事 — film.json + film.txt
│   ├── 02/                # 糖尿病控糖故事 — film.txt only
│   ├── 03/                # 胸痛就医故事 — film.json + film.txt
│   └── 04/                # 审讯机器人故事 — film.json only
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

# 只跑流程测试（所有 fixture）
pnpm test -- pipeline

# 只跑某个 fixture（如 01）
pnpm test -- pipeline -t "01"

# 跑多个 fixture（如 01 和 03）
pnpm test -- pipeline -t "01|03"

# 只跑轮询测试
pnpm test -- poll-task

# watch 模式（文件变化自动重跑）
pnpm test:watch
```

## 测试说明

### pipeline.test.ts

验证完整 pipeline 流程，需要 `VOLC_API_KEY`。

测试按 fixture 目录参数化，每个目录生成一个 describe block，名字即目录号（"01"、"02" 等）。各目录根据文件内容决定运行哪些 case：

| fixture | 包含文件 | 运行的 case |
|---------|----------|-------------|
| 01 — ACE销售故事 | film.json + film.txt | 从 JSON 跑全流程、从指定 stage 恢复、重试失败 stage、从 TXT 跑全流程 |
| 02 — 糖尿病控糖故事 | film.txt only | 从 TXT 跑全流程 |
| 03 — 胸痛就医故事 | film.json + film.txt | 从 JSON 跑全流程、从指定 stage 恢复、重试失败 stage、从 TXT 跑全流程 |
| 04 — 审讯机器人故事 | film.json only | 从 JSON 跑全流程、从指定 stage 恢复、重试失败 stage |

- **从 JSON 跑全流程** — 读取目录下的 `film.json`，创建项目，逐 stage 执行，验证产物
- **从 TXT 跑全流程** — 读取目录下的 `film.txt`，解析后创建项目并执行
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
