import { describe, expect, it } from "vitest";
import { polishSubtitleSegments } from "../src/worker/subtitle-polisher";
import type { SubtitleSegment } from "../src/shared/types";
import type { Env } from "../src/worker/types";

type TestEnv = Env & {
  LLM_PROVIDER?: string;
  LLM_API_KEY?: string;
  GEMINI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_BASE_URL?: string;
};

const baseSegments: SubtitleSegment[] = [
  { index: 1, startMs: 0, endMs: 1200, text: "这个就是预算的，呃，财务会计科目。" },
  { index: 2, startMs: 1200, endMs: 2200, text: "啊" },
  { index: 3, startMs: 2400, endMs: 3600, text: "然后然后我们点击保存。" }
];

describe("subtitle LLM polishing", () => {
  it("uses Gemini JSON output and maps polished text back to source time spans", async () => {
    const result = await polishSubtitleSegments(env({
      LLM_PROVIDER: "gemini",
      LLM_API_KEY: "test-value" // pragma: allowlist secret
    }), baseSegments, {
      fetch: async () => jsonResponse({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                segments: [
                  { sourceSegmentIds: [1], text: "这是预算的财务会计科目。" },
                  { sourceSegmentIds: [3], text: "然后我们点击保存。" }
                ]
              })
            }]
          }
        }]
      })
    });

    expect(result.metadata.status).toBe("polished");
    expect(result.metadata.provider).toBe("gemini");
    expect(result.segments).toEqual([
      { index: 1, startMs: 0, endMs: 1200, text: "这是预算的财务会计科目", speaker: undefined },
      { index: 2, startMs: 2400, endMs: 3600, text: "然后我们点击保存", speaker: undefined }
    ]);
  });

  it("uses DeepSeek JSON mode and supports adjacent segment merges across incomplete fragments", async () => {
    const result = await polishSubtitleSegments(env({
      LLM_PROVIDER: "deepseek",
      LLM_API_KEY: "test-value" // pragma: allowlist secret
    }), baseSegments, {
      fetch: async () => jsonResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              segments: [{ sourceSegmentIds: [1, 3], text: "这是预算的财务会计科目，然后点击保存。" }]
            })
          }
        }]
      })
    });

    expect(result.metadata.provider).toBe("deepseek");
    expect(result.segments).toEqual([
      { index: 1, startMs: 0, endMs: 3600, text: "这是预算的财务会计科目，然后点击保存", speaker: undefined }
    ]);
  });

  it("retries once before falling back when the first LLM output is invalid", async () => {
    let calls = 0;

    const result = await polishSubtitleSegments(env({
      LLM_PROVIDER: "deepseek",
      LLM_API_KEY: "test-value" // pragma: allowlist secret
    }), baseSegments, {
      fetch: async () => {
        calls += 1;
        if (calls === 1) return jsonResponse({ choices: [{ message: { content: "not json" } }] });
        return jsonResponse({
          choices: [{
            message: {
              content: JSON.stringify({
                segments: [{ sourceSegmentIds: [1, 3], text: "这是预算的财务会计科目，然后点击保存。" }]
              })
            }
          }]
        });
      }
    });

    expect(calls).toBe(2);
    expect(result.metadata.status).toBe("polished");
    expect(result.segments[0]?.text).toBe("这是预算的财务会计科目，然后点击保存");
  });

  it("falls back when model references invalid source ids", async () => {
    const result = await polishSubtitleSegments(env({
      LLM_PROVIDER: "deepseek",
      LLM_API_KEY: "test-value" // pragma: allowlist secret
    }), baseSegments, {
      fetch: async () => jsonResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              segments: [{ sourceSegmentIds: [99], text: "错误来源。" }]
            })
          }
        }]
      })
    });

    expect(result.metadata.status).toBe("fallback");
    expect(result.segments).toEqual(baseSegments);
  });

  it("splits overlong polished text locally after validation", async () => {
    const result = await polishSubtitleSegments(env({
      LLM_PROVIDER: "gemini",
      LLM_API_KEY: "test-value" // pragma: allowlist secret
    }), [
      { index: 1, startMs: 0, endMs: 6000, text: "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十" }
    ], {
      fetch: async () => jsonResponse({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                segments: [{ sourceSegmentIds: [1], text: "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十" }]
              })
            }]
          }
        }]
      })
    });

    expect(result.metadata.status).toBe("polished");
    expect(result.segments).toHaveLength(3);
    expect(result.segments.every((segment) => segment.text.length <= 22)).toBe(true);
    expect(result.segments.at(-1)?.endMs).toBe(6000);
  });


  it("splits multiple complete sentences into separate subtitle segments", async () => {
    const result = await polishSubtitleSegments(env({
      LLM_PROVIDER: "gemini",
      LLM_API_KEY: "test-value" // pragma: allowlist secret
    }), [
      { index: 1, startMs: 0, endMs: 5000, text: "我们先看智能财务模块。然后进入预算设置页面。" }
    ], {
      fetch: async () => jsonResponse({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                segments: [{ sourceSegmentIds: [1], text: "我们先看智能财务模块。然后进入预算设置页面。" }]
              })
            }]
          }
        }]
      })
    });

    expect(result.segments.map((segment) => segment.text)).toEqual([
      "我们先看智能财务模块",
      "然后进入预算设置页面"
    ]);
    expect(result.segments[0]?.startMs).toBe(0);
    expect(result.segments.at(-1)?.endMs).toBe(5000);
  });

  it("keeps semantic phrases intact when splitting long polished text", async () => {
    const longText = "我们先看一看现在有一个付费的模块叫智能财务模块，然后再进入预算设置页面查看审批流程。";

    const result = await polishSubtitleSegments(env({
      LLM_PROVIDER: "gemini",
      LLM_API_KEY: "test-value" // pragma: allowlist secret
    }), [
      { index: 1, startMs: 0, endMs: 7000, text: longText }
    ], {
      fetch: async () => jsonResponse({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                segments: [{ sourceSegmentIds: [1], text: longText }]
              })
            }]
          }
        }]
      })
    });

    expect(result.segments.map((segment) => segment.text).join("")).toBe("我们先看一看现在有一个付费的模块叫智能财务模块然后再进入预算设置页面查看审批流程");
    expect(result.segments.some((segment) => segment.text.includes(","))).toBe(false);
    expect(result.segments.some((segment) => segment.text.endsWith("智能财"))).toBe(false);
    expect(result.segments.every((segment) => segment.text.length <= 22)).toBe(true);
  });

  it("normalizes split English words and Chinese numerals in polished text", async () => {
    const result = await polishSubtitleSegments(env({
      LLM_PROVIDER: "deepseek",
      LLM_API_KEY: "test-value" // pragma: allowlist secret
    }), [
      { index: 1, startMs: 0, endMs: 1800, text: "D em o 里有十五个 A P I 字段，金额是五千元。" }
    ], {
      fetch: async () => jsonResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              segments: [{ sourceSegmentIds: [1], text: "D em o 里有十五个 A P I 字段，金额是五千元。" }]
            })
          }
        }]
      })
    });

    expect(result.segments.map((segment) => segment.text).join("")).toBe("Demo 里有15个 API 字段金额是5000元");
    expect(result.segments.every((segment) => segment.text.length <= 22)).toBe(true);
  });

  it("keeps useful middle punctuation but removes leading and trailing punctuation", async () => {
    const result = await polishSubtitleSegments(env({
      LLM_PROVIDER: "deepseek",
      LLM_API_KEY: "test-value" // pragma: allowlist secret
    }), [
      { index: 1, startMs: 0, endMs: 2200, text: "，比如说我录了三类：业务招待费、通讯费和餐旅费。" }
    ], {
      fetch: async () => jsonResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              segments: [{ sourceSegmentIds: [1], text: "，比如说我录了三类：业务招待费、通讯费和餐旅费。" }]
            })
          }
        }]
      })
    });

    expect(result.segments.map((segment) => segment.text).join("")).toBe("比如说我录了三类：业务招待费通讯费和餐旅费");
    expect(result.segments.some((segment) => segment.text.endsWith("、"))).toBe(false);
  });

  it("does not convert casual small Chinese numerals to Arabic numbers", async () => {
    const result = await polishSubtitleSegments(env({
      LLM_PROVIDER: "deepseek",
      LLM_API_KEY: "test-value" // pragma: allowlist secret
    }), [
      { index: 1, startMs: 0, endMs: 2200, text: "这个是一个管理平台，有三类业务费用。" }
    ], {
      fetch: async () => jsonResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              segments: [{ sourceSegmentIds: [1], text: "这个是一个管理平台，有三类业务费用。" }]
            })
          }
        }]
      })
    });

    expect(result.segments.map((segment) => segment.text).join("")).toBe("这个是一个管理平台，有三类业务费用");
  });

  it("defaults to DeepSeek and falls back to Gemini when DeepSeek fails", async () => {
    const calls: string[] = [];

    const result = await polishSubtitleSegments(env({
      DEEPSEEK_API_KEY: "deepseek-test-value", // pragma: allowlist secret
      GEMINI_API_KEY: "gemini-test-value" // pragma: allowlist secret
    }), [
      { index: 1, startMs: 0, endMs: 1000, text: "这个模块可以保存。" }
    ], {
      fetch: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("deepseek")) return new Response("rate limited", { status: 429 });
        return jsonResponse({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  segments: [{ sourceSegmentIds: [1], text: "这个模块可以保存。" }]
                })
              }]
            }
          }]
        });
      }
    });

    expect(calls.filter((url) => url.includes("deepseek"))).toHaveLength(2);
    expect(calls.at(-1)).toContain("generativelanguage.googleapis.com");
    expect(result.metadata.status).toBe("polished");
    expect(result.metadata.provider).toBe("gemini");
    expect(result.segments[0]?.text).toBe("这个模块可以保存");
  });

  it("passes custom subtitle prompt instructions to the model", async () => {
    let systemContent = "";

    await polishSubtitleSegments(env({
      LLM_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "deepseek-test-value" // pragma: allowlist secret
    }), baseSegments, {
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
        systemContent = body.messages[0]!.content;
        return jsonResponse({
          choices: [{
            message: {
              content: JSON.stringify({
                segments: [{ sourceSegmentIds: [1, 3], text: "这是预算的财务会计科目然后点击保存" }]
              })
            }
          }]
        });
      }
    }, { customInstruction: "用更短的飞书妙记风格字幕，不显示标点。" });

    expect(systemContent).toContain("用更短的飞书妙记风格字幕");
  });

  it("falls back to original segments when provider is off, missing key, or model output is invalid", async () => {
    const off = await polishSubtitleSegments(env({ LLM_PROVIDER: "off" }), baseSegments);
    const missingKey = await polishSubtitleSegments(env({ LLM_PROVIDER: "gemini" }), baseSegments);
    const invalid = await polishSubtitleSegments(env({
      LLM_PROVIDER: "deepseek",
      LLM_API_KEY: "test-value" // pragma: allowlist secret
    }), baseSegments, {
      fetch: async () => jsonResponse({ choices: [{ message: { content: "not json" } }] })
    });

    expect(off.metadata.status).toBe("disabled");
    expect(missingKey.metadata.status).toBe("fallback");
    expect(invalid.metadata.status).toBe("fallback");
    expect(invalid.segments).toEqual(baseSegments);
  });
});

function env(values: Partial<TestEnv>): Env {
  return values as Env;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
