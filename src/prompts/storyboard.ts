import type { CharacterSpec, ShotSpec, VideoStyle } from "../types.js";

/**
 * Build an image generation prompt for a storyboard grid.
 * Grid size adapts to the number of shots; continuity from previous act's last shot is optional.
 */

const STYLE_KEYWORDS: Record<VideoStyle, string> = {
  cinematic:
    "粗犷铅笔分镜草图绘于奶油色纹理纸上。石墨涂痕、制片铅笔标记、红色构图线。电影级构图，35mm胶片构图美学。",
  anime:
    "干净的动画分镜草图风格。粗墨线勾勒加淡铅笔阴影，动画构图美学，适当加入冲击线。",
  "3d-pixar":
    "皮克斯风格分镜草图。圆润造型、富有表现力的动态速写、温暖的制片板美学。黑白铅笔绘于奶油色纸上。",
};

export interface StoryboardContinuity {
  lastShot: ShotSpec;
  lastShotDescription?: string;
}

export function buildStoryboardPrompt(
  shots: ShotSpec[],
  characters: CharacterSpec[],
  style: string,
  grid: { cols: number; rows: number },
  continuity?: StoryboardContinuity,
  actNum?: number,
): string {
  const styleKey = style as VideoStyle;
  const styleBlock = STYLE_KEYWORDS[styleKey] ?? STYLE_KEYWORDS["cinematic"];

  const totalPanels = grid.cols * grid.rows;
  const panelShots = shots.slice(0, totalPanels);

  // Build character reference block
  const characterBlock = characters
    .map((c) => `- ${c.name}: ${c.detail}`)
    .join("\n");

  // 构建与上一幕最后镜头的连续性说明
  let continuityBlock = "";
  if (continuity) {
    const last = continuity.lastShot;
    continuityBlock = `\n与上一场景的连续性：\n上一幕最后一格画面为：[${last.type}] ${last.action}${last.emotion ? `（情绪：${last.emotion}）` : ""}${continuity.lastShotDescription ? `\n画面：${continuity.lastShotDescription}` : ""}\n第1格必须自然衔接上一幕——相同角色、相同场景、一致的站位调度。\n`;
  }

  // 构建各格画面描述
  const panelBlock = panelShots
    .map((shot, i) => {
      const panelNum = i + 1;
      const parts: string[] = [];

      const header = `第${panelNum}格`;
      const shotType = shot.type ? `[${shot.type}]` : "";
      const camera = shot.camera ? `镜头运动：${shot.camera}` : "";
      const title = shot.title ? `"${shot.title}"` : "";

      parts.push(header);
      if (title || shotType) {
        parts.push(`${title} ${shotType}`.trim());
      }
      if (camera) {
        parts.push(camera);
      }
      parts.push(shot.action);
      if (shot.emotion) {
        parts.push(`情绪：${shot.emotion}`);
      }

      return parts.join(" — ");
    })
    .join("\n\n");

  // 标注色彩系统（参考技术指南 §3.1 建议）
  const annotationBlock = `标注色彩系统（绘制在草图之上，不作为画面内容渲染）：
- 红色箭头 = 角色身体运动方向
- 蓝色箭头 = 镜头运动方向
- 绿色标记 = 构图/取景注释
- 橙色标记 = 光源方向
- 紫色标记 = 情绪强调
- 黑色文字 = 景别标签与格号

格内不标注时间戳。`;

  const seriesAnchor =
    actNum !== undefined && actNum > 1
      ? `这是多幕分镜系列中的第${actNum}幕。必须保持与前面各幕完全一致的视觉风格：相同纸张纹理、相同线条粗细、相同色彩搭配、相同角色设计比例。\n\n`
      : "";

  return `${seriesAnchor}生成一份${panelShots.length}格电影分镜板，布局为${grid.cols}列×${grid.rows}行网格。
每格画面比例为16:9。画面本身必须仅用黑白：粗犷铅笔线条、最少细节、快速动态速写笔触、简洁人体结构和清晰剪影辨识度。

${styleBlock}

角色（在所有格中保持完全一致的外观）：
${characterBlock}
${continuityBlock}
各格内容（从左至右、从上至下阅读）：

${panelBlock}

每一格都必须包含明显的运动感和强烈的身体动态。避免静止站立姿势。

${annotationBlock}

在每格左上角标注格号（1-${panelShots.length}）。每格下方附简短景别标签。`;
}
