import { describe, expect, it, vi } from "vitest";
import { VOLC_BASE_URL } from "../src/config.js";

interface TaskResponse {
  status?: string;
  content?: { video_url?: string; duration?: number };
  output?: { video_url?: string };
  error?: { message?: string; code?: string };
  error_message?: string;
  data?: {
    status?: string;
    content?: { video_url?: string; duration?: number };
    video_url?: string;
    error_message?: string;
  };
}

interface PollResult {
  done: boolean;
  status: string;
  videoUrl?: string;
  duration?: number;
  error?: string;
}

function parseTaskResponse(data: TaskResponse): PollResult {
  const status: string = data.status ?? data.data?.status ?? "unknown";

  const SUCCESS = new Set(["SUCCESS", "SUCCEEDED", "succeeded", "complete"]);
  const FAILURE = new Set(["FAILED", "failed", "error"]);

  if (SUCCESS.has(status)) {
    const videoUrl =
      data.content?.video_url ??
      data.data?.content?.video_url ??
      data.output?.video_url ??
      data.data?.video_url;
    const duration =
      data.content?.duration ?? data.data?.content?.duration ?? 0;
    return { done: true, status, videoUrl, duration };
  }

  if (FAILURE.has(status)) {
    const error =
      data.error?.message ??
      data.error?.code ??
      data.error_message ??
      data.data?.error_message ??
      "Unknown error";
    return { done: true, status, error };
  }

  return { done: false, status };
}

describe("parseTaskResponse", () => {
  it.each([
    "SUCCESS",
    "SUCCEEDED",
    "succeeded",
    "complete",
  ])("识别成功状态: %s", (status) => {
    const result = parseTaskResponse({
      status,
      content: { video_url: "https://example.com/v.mp4", duration: 15 },
    });
    expect(result.done).toBe(true);
    expect(result.videoUrl).toBe("https://example.com/v.mp4");
    expect(result.duration).toBe(15);
  });

  it.each(["FAILED", "failed", "error"])("识别失败状态: %s", (status) => {
    const result = parseTaskResponse({
      status,
      error_message: "content policy violation",
    });
    expect(result.done).toBe(true);
    expect(result.error).toBe("content policy violation");
  });

  it("pending 状态返回 done=false", () => {
    const result = parseTaskResponse({ status: "pending" });
    expect(result.done).toBe(false);
    expect(result.status).toBe("pending");
  });

  it("从嵌套 data 字段解析状态", () => {
    const result = parseTaskResponse({
      data: {
        status: "SUCCEEDED",
        content: { video_url: "https://example.com/nested.mp4", duration: 10 },
      },
    });
    expect(result.done).toBe(true);
    expect(result.videoUrl).toBe("https://example.com/nested.mp4");
    expect(result.duration).toBe(10);
  });

  it("从嵌套 data 字段解析错误信息", () => {
    const result = parseTaskResponse({
      data: { status: "FAILED", error_message: "timeout" },
    });
    expect(result.done).toBe(true);
    expect(result.error).toBe("timeout");
  });

  it("从 output 字段解析 video_url", () => {
    const result = parseTaskResponse({
      status: "SUCCESS",
      output: { video_url: "https://example.com/output.mp4" },
    });
    expect(result.videoUrl).toBe("https://example.com/output.mp4");
  });

  it("从 data.video_url 解析 video_url", () => {
    const result = parseTaskResponse({
      status: "SUCCESS",
      data: { video_url: "https://example.com/data.mp4" },
    });
    expect(result.videoUrl).toBe("https://example.com/data.mp4");
  });

  it("失败无 error_message 时返回默认错误", () => {
    const result = parseTaskResponse({ status: "FAILED" });
    expect(result.error).toBe("Unknown error");
  });

  it("无状态字段时返回 unknown", () => {
    const result = parseTaskResponse({});
    expect(result.done).toBe(false);
    expect(result.status).toBe("unknown");
  });
});

describe("pollOnce", () => {
  const TASK_ID = "cgt-test-123";
  const API_KEY = "test-key";

  async function pollOnce(taskId: string, apiKey: string): Promise<PollResult> {
    const url = `${VOLC_BASE_URL}/contents/generations/tasks/${taskId}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data: TaskResponse = await res.json();
    return parseTaskResponse(data);
  }

  it("HTTP 错误抛出异常", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      }),
    );

    await expect(pollOnce(TASK_ID, API_KEY)).rejects.toThrow("HTTP 500");

    vi.unstubAllGlobals();
  });

  it("成功响应返回完成结果", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "SUCCEEDED",
          content: { video_url: "https://cdn.example.com/v.mp4", duration: 15 },
        }),
      }),
    );

    const result = await pollOnce(TASK_ID, API_KEY);
    expect(result.done).toBe(true);
    expect(result.videoUrl).toBe("https://cdn.example.com/v.mp4");

    vi.unstubAllGlobals();
  });

  it("请求携带正确的 Authorization header", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "pending" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await pollOnce(TASK_ID, API_KEY);

    expect(mockFetch).toHaveBeenCalledWith(
      `${VOLC_BASE_URL}/contents/generations/tasks/${TASK_ID}`,
      { headers: { Authorization: "Bearer test-key" } },
    );

    vi.unstubAllGlobals();
  });
});
