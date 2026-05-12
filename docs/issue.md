# 问题列表

1. @src/pipeline/stages/2-storyboard.ts raw 图生成还有问题，发现一个 raw 有 10 个镜头，但是最后 2 个镜头宽度和其他镜头宽度不一样，导致切分的 panel 不完整，需要严格要求每个镜头的宽高不能变化
2. @projects/a7911b6e-0e07-4d02-a254-528c957c9a86/prompts/segment-1.json 提示词中 prompt 字段中英混杂是什么情况？是否有必要把全部字段都换成中文
3. 生成视频时如果全部采用 referenceImageRefs 的方式，是否可以保证角色一致、视频无缝衔接，使用 imageRef 和 lastFrameRef 时就不能使用 referenceImageRefs 也就无法引用角色图片，也无法将上一幕视频的最后一帧当中下一个视频的第一帧（在之前的对话中你错误的理解为：“幕间衔接：上一幕最后一个 panel 的描述传入下一幕的 prompt”，我不确定是否影响流程）