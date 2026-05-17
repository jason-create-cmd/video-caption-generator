import type {
  RawSonioxToken,
  SonioxToken,
  SubtitleArtifacts,
  SubtitlePolishMetadata,
  SubtitleSegment
} from "./types";

const DEFAULT_MAX_CHINESE_CHARS = 22;
const DEFAULT_MIN_DURATION_MS = 1000;
const DEFAULT_MAX_DURATION_MS = 5000;
const DEFAULT_PAUSE_BREAK_MS = 700;
const DEFAULT_VIDEO_WIDTH = 1920;
const DEFAULT_VIDEO_HEIGHT = 1080;
const BASE_ASS_FONT_SIZE = 44;
const ASS_MARGIN_V_RATIO = 0.045;

export type BuildSubtitleOptions = {
  baseName: string;
  maxChineseChars?: number;
  minDurationMs?: number;
  maxDurationMs?: number;
  pauseBreakMs?: number;
  segments?: SubtitleSegment[];
  polish?: SubtitlePolishMetadata;
  videoWidth?: number;
  videoHeight?: number;
};

export function normalizeSonioxTokens(rawTokens: RawSonioxToken[]): SonioxToken[] {
  return rawTokens
    .map((token) => ({
      text: token.text,
      startMs: token.start_ms ?? 0,
      endMs: token.end_ms ?? token.start_ms ?? 0,
      confidence: token.confidence,
      speaker: token.speaker,
      language: token.language
    }))
    .filter((token) => token.text.length > 0 && token.endMs >= token.startMs);
}

export function buildSubtitleSegments(tokens: SonioxToken[], options: BuildSubtitleOptions): SubtitleSegment[] {
  const cleanTokens = tokens.filter((token) => token.text.trim().length > 0);
  return splitTokens(cleanTokens, options);
}

export function buildSubtitleArtifacts(tokens: SonioxToken[], options: BuildSubtitleOptions): SubtitleArtifacts {
  const cleanTokens = tokens.filter((token) => token.text.trim().length > 0);
  const rawSegments = splitTokens(cleanTokens, options);
  const segments = normalizeSegmentIndexes(options.segments ?? rawSegments);
  const rawText = cleanTokens.map((token) => token.text).join("");
  const polishedText = segments.map((segment) => segment.text).join("");
  const polish = options.polish ?? { status: "disabled", provider: "off" };

  return {
    segments,
    srt: renderSrt(segments),
    ass: renderAss(segments, {
      title: options.baseName,
      videoWidth: sanitizeDimension(options.videoWidth, DEFAULT_VIDEO_WIDTH),
      videoHeight: sanitizeDimension(options.videoHeight, DEFAULT_VIDEO_HEIGHT)
    }),
    transcriptJson: {
      text: polishedText,
      rawText,
      polishedText,
      tokens: cleanTokens,
      segments,
      polish,
      generatedAt: new Date().toISOString()
    }
  };
}

function splitTokens(tokens: SonioxToken[], options: BuildSubtitleOptions): SubtitleSegment[] {
  const maxChineseChars = options.maxChineseChars ?? DEFAULT_MAX_CHINESE_CHARS;
  const minDurationMs = options.minDurationMs ?? DEFAULT_MIN_DURATION_MS;
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const pauseBreakMs = options.pauseBreakMs ?? DEFAULT_PAUSE_BREAK_MS;
  const segments: SubtitleSegment[] = [];
  let buffer: SonioxToken[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const previous = buffer.at(-1);
    const speakerChanged = previous?.speaker !== undefined && token.speaker !== undefined && previous.speaker !== token.speaker;
    const pauseTooLong = previous ? token.startMs - previous.endMs >= pauseBreakMs : false;

    if (buffer.length > 0 && (speakerChanged || pauseTooLong)) {
      segments.push(toSegment(segments.length + 1, buffer));
      buffer = [];
    }

    buffer.push(token);

    const segmentText = joinTokens(buffer);
    const segmentStart = buffer[0]!.startMs;
    const segmentEnd = buffer.at(-1)!.endMs;
    const duration = segmentEnd - segmentStart;
    const nextToken = tokens[index + 1];
    const nextIsPunctuation = nextToken ? isLeadingPunctuation(nextToken.text) : false;
    const shouldBreakOnPunctuation = duration >= minDurationMs && isSentencePunctuation(token.text);
    const shouldBreakOnLength = countReadableChars(segmentText) >= maxChineseChars && !nextIsPunctuation;
    const shouldBreakOnDuration = duration >= maxDurationMs;

    if (shouldBreakOnPunctuation || shouldBreakOnLength || shouldBreakOnDuration) {
      segments.push(toSegment(segments.length + 1, buffer));
      buffer = [];
    }
  }

  if (buffer.length > 0) {
    segments.push(toSegment(segments.length + 1, buffer));
  }

  return segments;
}

function toSegment(index: number, tokens: SonioxToken[]): SubtitleSegment {
  return {
    index,
    startMs: tokens[0]!.startMs,
    endMs: Math.max(tokens.at(-1)!.endMs, tokens[0]!.startMs + 250),
    text: joinTokens(tokens).trim(),
    speaker: tokens[0]?.speaker
  };
}

function normalizeSegmentIndexes(segments: SubtitleSegment[]): SubtitleSegment[] {
  return segments
    .filter((segment) => segment.text.trim().length > 0 && segment.endMs > segment.startMs)
    .map((segment, index) => ({ ...segment, index: index + 1, text: segment.text.trim() }));
}

function joinTokens(tokens: SonioxToken[]): string {
  return tokens.reduce((text, token) => {
    if (text.length === 0) return token.text;
    if (needsLeadingSpace(text, token.text)) return `${text} ${token.text}`;
    return `${text}${token.text}`;
  }, "");
}

function needsLeadingSpace(current: string, next: string): boolean {
  if (/^[,.;:!?，。！？、；：）\]\}]/.test(next)) return false;
  if (/[\(\[\{（]$/.test(current)) return false;
  return /[A-Za-z0-9]$/.test(current) && /^[A-Za-z0-9]/.test(next);
}

function isSentencePunctuation(text: string): boolean {
  return /[。！？!?；;]$/.test(text);
}

function isLeadingPunctuation(text: string): boolean {
  return /^[,.;:!?，。！？、；：…]/.test(text.trim());
}

function countReadableChars(text: string): number {
  return Array.from(text.replace(/\s+/g, "")).length;
}

function renderSrt(segments: SubtitleSegment[]): string {
  return `${segments
    .map((segment) => [
      segment.index.toString(),
      `${formatSrtTime(segment.startMs)} --> ${formatSrtTime(segment.endMs)}`,
      segment.text,
      ""
    ].join("\n"))
    .join("\n")}`;
}

type AssRenderOptions = {
  title: string;
  videoWidth: number;
  videoHeight: number;
};

function renderAss(segments: SubtitleSegment[], options: AssRenderOptions): string {
  const fontSize = Math.round((options.videoHeight / DEFAULT_VIDEO_HEIGHT) * BASE_ASS_FONT_SIZE);
  const marginV = Math.round(options.videoHeight * ASS_MARGIN_V_RATIO);
  const lines = [
    "[Script Info]",
    `Title: ${escapeAssHeader(options.title)}`,
    "ScriptType: v4.00+",
    `PlayResX: ${options.videoWidth}`,
    `PlayResY: ${options.videoHeight}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,PingFang SC,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H99000000,0,0,0,0,100,100,0,0,3,12,0,2,80,80,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
  ];

  for (const segment of segments) {
    lines.push(
      `Dialogue: 0,${formatAssTime(segment.startMs)},${formatAssTime(segment.endMs)},Default,,0,0,0,,${escapeAssText(
        segment.text
      )}`
    );
  }

  return `${lines.join("\n")}\n`;
}

function sanitizeDimension(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return fallback;
  return Math.round(value);
}

function formatSrtTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const milliseconds = ms % 1000;
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${milliseconds.toString().padStart(3, "0")}`;
}

function formatAssTime(ms: number): string {
  const centiseconds = Math.floor((ms % 1000) / 10);
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${hours}:${pad(minutes)}:${pad(seconds)}.${centiseconds.toString().padStart(2, "0")}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function escapeAssText(text: string): string {
  return text.replace(/\\(?!N)/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

function escapeAssHeader(text: string): string {
  return text.replace(/\r?\n/g, " ").trim();
}
