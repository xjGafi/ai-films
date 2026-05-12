# 测试指南

## 前置条件

1. 在项目根目录创建 `.env` 文件：
```
VOLC_API_KEY=your-key-here
```

2. 确保 `ffmpeg` 和 `ffprobe` 在系统 PATH 中（video-gen 及后续阶段需要）：
```bash
# 检查
ffmpeg -version
ffprobe -version

# macOS 安装
brew install ffmpeg
```

## 1. Smoke Test（无需 API Key）

验证编译、项目 CRUD、状态管理、prompt 构建：

```bash
pnpm run test
```

约 1 秒完成，40+ 断言，覆盖：
- ProjectState 状态流转（pending → in_progress → completed / failed）
- 项目创建、加载、查找、清理
- Screenplay / Character / Storyboard / Seedance prompt 输出格式

## 2. Integration Test（需要 API Key）

测试真实 API 调用，按阶段运行：

```bash
# 跑所有阶段
pnpm run test:api

# 快速模式（短 prompt，跳过视频轮询）
pnpm run test:api:quick

# 只测某个阶段
VOLC_API_KEY=xxx npx tsx src/tests/integration.ts --stage 0   # LLM
VOLC_API_KEY=xxx npx tsx src/tests/integration.ts --stage 1   # 图片生成
VOLC_API_KEY=xxx npx tsx src/tests/integration.ts --stage 2   # 视频提交
VOLC_API_KEY=xxx npx tsx src/tests/intagement.ts --stage 4   # FFmpeg
```

FFmpeg 测试需要提供视频文件：
```bash
TEST_VIDEO_PATH=./test.mp4 npx tsx src/tests/integration.ts --stage 4
```

## 3. 完整 Pipeline 测试

### 配置项目

复制模板并编辑：
```bash
cp examples/film.json film.local.json
# 编辑 film.local.json，填写故事和角色
```

配置文件格式：
```json
{
  "story": "你的故事描述",
  "characters": [
    { "name": "角色名", "description": "角色外貌描述" },
    { "name": "角色名", "imagePath": "./assets/ref.png" }
  ],
  "duration": 60,
  "style": "cinematic",
  "resolution": "720p",
  "seed": 42
}
```

### 运行

```bash
# 创建项目
pnpm run dev create --config film.local.json
# 输出 Project ID: xxxxxxxx-xxxx-...

# 运行完整流水线（耗时 20-40 分钟，主要在视频生成）
pnpm run dev run <project-id>

# 从某个阶段恢复运行
pnpm run dev run <project-id> --from video-gen

# 清理中间文件并重新开始
pnpm run dev run <project-id> --clean
```

### 查看状态

```bash
pnpm run dev status <project-id>
pnpm run dev list
```

### 输出文件

```
projects/<id>/
  screenplay.json          # Stage 0: 剧本
  characters/              # Stage 1: 角色参考图
  storyboard/              # Stage 2: 分镜图 + 裁切面板
  prompts/                 # Stage 3: 视频生成 prompt
  clips/                   # Stage 4: 视频片段
  frames/                  # Stage 4: 末帧截图（用于衔接）
  output/                  # Stage 6: 最终成片
```

## 4. 类型检查 & Lint

```bash
pnpm run typecheck     # TypeScript 类型检查
pnpm run lint          # Biome 格式 + lint 检查
pnpm run format        # 自动修复格式和 lint 问题
```

## 常见问题

**Q: video-gen 阶段超时怎么办？**

Seedance 视频生成可能需要 5-10 分钟/片段，3 次超时后会跳过。稍后重试：
```bash
pnpm run dev run <project-id> --from video-gen
```

**Q: storyboard 报 "image size must be at least 3686400 pixels"？**

已修复——动态网格布局会自动调整图片尺寸。如果仍有问题，检查 `storyboardGrid()` 的网格计算是否满足最低像素要求。

**Q: 如何只测 5 秒短视频？**

修改 `film.local.json` 中 `duration` 为最小值，或在配置文件中设置更短的分段。
