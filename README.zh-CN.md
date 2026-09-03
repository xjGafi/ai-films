# ai-films

**把一段短故事自动变成一部完整的 1–2 分钟 AI 影片。**

`ai-films` 是一个 TypeScript CLI 流水线，端到端生成 AI 短片：从故事到剧本、角色、分镜、视频片段、转场，再到最终合成。它基于火山引擎模型家族（Doubao 做文本、Seedream 做图片、Seedance 2.0 做视频），通过 OpenAI 兼容的 API 层调用。

## 亮点

- 🎬 **端到端流水线** — 从原始故事到最终 MP4 共 7 个阶段，中间无需任何手工操作。
- 📝 **结构化剧本** — LLM 把你的故事转成结构化影片配置（场景、镜头、角色）。
- 👤 **角色一致性** — 参考图（正面 + 3/4 侧面）让同一角色在所有镜头中保持一致。
- 🗣️ **对白与配音** — 分镜台词注入视频提示词，默认开启音频生成。
- 🔁 **可续跑、可观测** — 每个阶段都持久化状态，可以从任意阶段续跑，并逐阶段查看进度。
- 🔌 **模型无关的设计** — 所有模型调用都通过官方 OpenAI SDK 打到 OpenAI 兼容网关，切换模型后端只是改配置，不是重写代码。
- 🧩 **确定性控制** — 时长（60/90/120 秒）、风格（`cinematic` | `anime` | `3d-pixar`）、分辨率、随机种子。

## 工作原理

| # | 阶段 | 做什么 |
|---|------|--------|
| 0 | `screenplay` | LLM 根据故事生成结构化剧本 |
| 1 | `characters` | 生成/复制角色参考图 |
| 2 | `storyboard` | 生成 4×3 分镜网格，用 sharp 裁剪分格 |
| 3 | `prompts` | 为每个片段组装 Seedance 2.0 视频提示词 |
| 4 | `video-gen` | 提交视频任务、异步轮询、下载片段 |
| 5 | `transitions` | 制定拼接方案与转场策略 |
| 6 | `assembly` | 用 ffmpeg 把片段拼接成最终影片 |

视频生成是异步的：提交任务 → 轮询直到成功 → 下载片段。最终影片输出到 `projects/<project-id>/output/final.mp4`。

## 环境要求

- Node.js 18+（在 Node 22 上开发）
- pnpm
- `ffmpeg` 和 `ffprobe` 在系统 `PATH` 中
- 一个火山引擎 API key

## 安装

```bash
git clone https://github.com/xjGafi/ai-films.git
cd ai-films
pnpm install
```

在仓库根目录创建 `.env` 文件：

```bash
VOLC_API_KEY=你的火山引擎-api-key
```

所有模型调用都走 `src/config.ts` 中配置的 OpenAI 兼容网关，无需其他账号配置。

> 请在仓库根目录运行 CLI：项目状态持久化在相对当前工作目录的 `projects/<uuid>/` 下。

## 使用方法

```bash
# 1. 用一段短故事创建项目，可附带角色参考图
pnpm dev create -s "一个小女孩在雪地里发现了一盏发光的灯笼..." \
  -c "Mira:./characters/mira.png" \
  -d 60 --style cinematic --resolution 720p

# 2. 运行完整流水线
pnpm dev run <project-id>

# 3. 查看进度
pnpm dev status <project-id>
pnpm dev list
```

也可以用 JSON 配置文件驱动：

```bash
pnpm dev create --config film.json
```

还可以把纯文本故事解析成 `film.json` 配置并一步跑完：

```bash
pnpm dev parse story.txt --output film.json --run
```

## CLI 命令参考

| 命令 | 说明 |
|---|---|
| `create` | 创建新项目。选项：`--story/-s`、`--character/-c <名字:路径>`（可重复）、`--duration/-d <60\|90\|120>`、`--style <cinematic\|anime\|3d-pixar>`、`--resolution <720p\|1080p>`、`--seed <n>`、`--config <路径>` |
| `run <id>` | 运行项目流水线。选项：`--from <阶段>`、`--to <阶段>`、`--clean` |
| `status <id>` | 查看各阶段状态、产物和错误 |
| `list` | 列出所有项目及进度 |
| `clean <id>` | 清理中间文件，并把 `video-gen` 及之后的阶段重置 |
| `regen <id> --clip <N>` | 重新生成某个片段 |
| `parse <文件>` | 把故事文件解析成 `film.json` 配置。选项：`--output <路径>`、`--run`、`--dry-run` |

## 项目结构

```
src/
├── cli.ts                  # CLI 入口（commander）
├── config.ts               # API 网关、模型、默认参数
├── project.ts              # 项目创建 / 查找
├── pipeline/
│   ├── runner.ts           # 阶段调度器（顺序执行 + 断点续跑）
│   ├── state.ts            # JSON 状态持久化（state.json）
│   ├── parse.ts            # 故事 → film.json 解析
│   └── stages/             # 0-screenplay … 6-assembly
├── providers/
│   ├── volcengine.ts       # 火山引擎 API 统一封装（文本 / 图片 / 视频）
│   └── ffmpeg.ts           # ffmpeg / ffprobe 辅助函数
├── prompts/                # LLM 提示词模板
└── types.ts                # 共享类型与阶段名
projects/<uuid>/            # 运行状态：state.json、clips/、frames/、output/
docs/                       # 架构与 API 文档（中文）
scripts/                    # 实用脚本（如 resume-video.ts）
```

## 开发

```bash
pnpm dev         # 用 tsx 运行 CLI（无需构建）
pnpm build       # 编译 TypeScript 到 dist/
pnpm typecheck   # 类型检查（不产出文件）
pnpm lint        # Biome 检查
pnpm format      # 自动修复格式与 lint 问题
pnpm test        # 运行测试（vitest）
```

## 已知限制

- `4-video-gen` 中部分角色参考模式把本地文件路径传给了需要 URL 的 API（上传机制尚未实现）。
- `regen --clip <N>` 目前还没有按片段索引生效，总是从 `video-gen` 阶段重新运行。

## 文档

更深入的设计文档在 [`docs/`](docs/) 中（以中文为主），包括产品架构设计、API 与流水线完整指南、Seedance 2.0 参数完整解析。
