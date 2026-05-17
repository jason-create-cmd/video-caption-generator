import { describe, expect, it } from "vitest";
import { buildSubtitleArtifacts } from "../src/shared/subtitles";
import type { SonioxToken } from "../src/shared/types";

describe("subtitle generation", () => {
  it("splits Chinese tokens by punctuation, long text, and pause", () => {
    const tokens: SonioxToken[] = [
      token("今", 0, 180),
      token("天", 180, 360),
      token("我", 360, 540),
      token("们", 540, 720),
      token("测", 720, 900),
      token("试", 900, 1080),
      token("一", 1080, 1260),
      token("下", 1260, 1440),
      token("。", 1440, 1500),
      token("这", 2600, 2780),
      token("是", 2780, 2960),
      token("第", 2960, 3140),
      token("二", 3140, 3320),
      token("句", 3320, 3500)
    ];

    const artifacts = buildSubtitleArtifacts(tokens, { baseName: "demo" });

    expect(artifacts.segments).toHaveLength(2);
    expect(artifacts.segments[0]?.text).toBe("今天我们测试一下。");
    expect(artifacts.segments[1]?.startMs).toBe(2600);
    expect(artifacts.srt).toContain("00:00:00,000 --> 00:00:01,500");
    expect(artifacts.ass).toContain("Dialogue: 0,0:00:00.00,0:00:01.50");
  });


  it("keeps trailing punctuation with the current subtitle when length limit is reached", () => {
    const artifacts = buildSubtitleArtifacts([
      token("今", 0, 100),
      token("天", 100, 200),
      token("我", 200, 300),
      token("们", 300, 400),
      token("测", 400, 500),
      token("试", 500, 600),
      token("。", 600, 700),
      token("下", 1000, 1100),
      token("一", 1100, 1200),
      token("句", 1200, 1300)
    ], { baseName: "demo", maxChineseChars: 6 });

    expect(artifacts.segments[0]?.text).toBe("今天我们测试。");
    expect(artifacts.segments[1]?.text.startsWith("。")).toBe(false);
  });

  it("escapes ASS control characters and keeps transcript json", () => {
    const tokens: SonioxToken[] = [
      token("A", 0, 200),
      token("{", 200, 300),
      token("B", 300, 500)
    ];

    const artifacts = buildSubtitleArtifacts(tokens, { baseName: "demo" });

    expect(artifacts.ass).toContain("A\\{B");
    expect(artifacts.transcriptJson.tokens).toHaveLength(3);
  });
});

function token(text: string, startMs: number, endMs: number): SonioxToken {
  return { text, startMs, endMs };
}

describe("ASS rendering", () => {
  it("writes PlayRes and uses readable Feishu-like style scaled to video size", () => {
    const artifacts = buildSubtitleArtifacts([
      token("我们", 0, 400),
      token("测试", 400, 900),
      token("字幕", 900, 1300),
      token("。", 1300, 1400)
    ], { baseName: "demo", videoWidth: 1332, videoHeight: 1080 });

    expect(artifacts.ass).toContain("PlayResX: 1332");
    expect(artifacts.ass).toContain("PlayResY: 1080");
    expect(artifacts.ass).toContain("Style: Default,PingFang SC,44");
    expect(artifacts.ass).toContain(",3,12,0,2,80,80,49,1");
  });

  it("keeps raw and polished transcript metadata when polished segments are supplied", () => {
    const artifacts = buildSubtitleArtifacts([
      token("这个", 0, 300),
      token("呃", 300, 500),
      token("预算", 500, 900)
    ], {
      baseName: "demo",
      segments: [{ index: 1, startMs: 0, endMs: 900, text: "这个预算" }],
      polish: { status: "polished", provider: "gemini", model: "gemini-2.5-flash" }
    });

    expect(artifacts.segments[0]?.text).toBe("这个预算");
    expect(artifacts.transcriptJson.rawText).toBe("这个呃预算");
    expect(artifacts.transcriptJson.polishedText).toBe("这个预算");
    expect(artifacts.transcriptJson.polish.status).toBe("polished");
  });

  it("does not manually wrap ASS events into two subtitle lines", () => {
    const artifacts = buildSubtitleArtifacts([
      token("这是一条比较长但应该由上游切成单行事件的字幕", 0, 2000)
    ], { baseName: "demo" });

    expect(artifacts.ass).not.toContain("\\N");
  });
});
