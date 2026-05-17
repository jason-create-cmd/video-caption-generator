import type { LlmProvider, SubtitlePolishMetadata, SubtitleSegment } from "../shared/types";
import { DEFAULT_SUBTITLE_POLISH_INSTRUCTION } from "../shared/subtitle-prompt";
import type { Env } from "./types";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEEPSEEK_API_BASE = "https://api.deepseek.com";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const MAX_ATTEMPTS = 2;
const LLM_TIMEOUT_MS = 25_000;

type LlmEnv = Env & {
  LLM_PROVIDER?: string;
  LLM_API_KEY?: string;
  GEMINI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_BASE_URL?: string;
};

type PolishRuntime = {
  fetch?: typeof fetch;
};

type PolishOptions = {
  customInstruction?: string | null;
};

export type SubtitlePolishResult = {
  segments: SubtitleSegment[];
  metadata: SubtitlePolishMetadata;
};

type LlmSubtitleSegment = {
  sourceSegmentIds?: unknown;
  text?: unknown;
};

type LlmSubtitlePayload = {
  segments?: unknown;
};

export async function polishSubtitleSegments(
  env: Env,
  segments: SubtitleSegment[],
  runtime: PolishRuntime = {},
  options: PolishOptions = {}
): Promise<SubtitlePolishResult> {
  const llmEnv = env as LlmEnv;
  const providers = resolveProviderSequence(llmEnv.LLM_PROVIDER);
  const instruction = resolveInstruction(options.customInstruction);
  const usesCustomInstruction = Boolean(options.customInstruction?.trim());

  if (providers.length === 0) {
    return fallbackResult(segments, { status: "disabled", provider: "off" });
  }

  const fetcher = runtime.fetch ?? fetch;
  let lastError = "LLM output is invalid";
  let lastProvider = providers[0]!;
  let lastModel = resolveModel(lastProvider, llmEnv.LLM_MODEL);

  for (const provider of providers) {
    const model = resolveModel(provider, provider === providers[0] ? llmEnv.LLM_MODEL : undefined);
    const apiKey = resolveApiKey(provider, llmEnv);
    lastProvider = provider;
    lastModel = model;

    if (!apiKey) {
      lastError = `${provider} API key is missing`;
      continue;
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const output = await requestPolishedJson(provider, model, apiKey, llmEnv, segments, fetcher, instruction);
        const polished = normalizeSubtitleBoundaries(mapValidatedSegments(segments, output));
        return {
          segments: splitLongSegments(polished),
          metadata: { status: "polished", provider, model, customInstruction: usesCustomInstruction }
        };
      } catch (error) {
        lastError = `${provider}: ${messageOf(error)}`;
      }
    }
  }

  return fallbackResult(segments, {
    status: "fallback",
    provider: lastProvider,
    model: lastModel,
    fallbackReason: lastError
  });
}

function resolveProviderSequence(value: string | undefined): Array<Exclude<LlmProvider, "off">> {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "off") return [];
  if (normalized === "gemini") return ["gemini"];
  return ["deepseek", "gemini"];
}

function resolveModel(provider: Exclude<LlmProvider, "off">, model: string | undefined): string {
  const cleanModel = model?.trim();
  if (cleanModel) return cleanModel;
  return provider === "gemini" ? DEFAULT_GEMINI_MODEL : DEFAULT_DEEPSEEK_MODEL;
}


function resolveApiKey(provider: Exclude<LlmProvider, "off">, env: LlmEnv): string | undefined {
  const providerKey = provider === "gemini" ? env.GEMINI_API_KEY : env.DEEPSEEK_API_KEY;
  return providerKey?.trim() || env.LLM_API_KEY?.trim() || undefined;
}

function resolveInstruction(customInstruction: string | null | undefined): string {
  return customInstruction?.trim() || DEFAULT_SUBTITLE_POLISH_INSTRUCTION;
}

function fallbackResult(segments: SubtitleSegment[], metadata: SubtitlePolishMetadata): SubtitlePolishResult {
  return {
    segments,
    metadata
  };
}

async function requestPolishedJson(
  provider: Exclude<LlmProvider, "off">,
  model: string,
  apiKey: string,
  env: LlmEnv,
  segments: SubtitleSegment[],
  fetcher: typeof fetch,
  instruction: string
): Promise<LlmSubtitlePayload> {
  if (provider === "gemini") {
    return requestGeminiJson(model, apiKey, env, segments, fetcher, instruction);
  }
  return requestDeepSeekJson(model, apiKey, env, segments, fetcher, instruction);
}

async function requestGeminiJson(
  model: string,
  apiKey: string,
  env: LlmEnv,
  segments: SubtitleSegment[],
  fetcher: typeof fetch,
  instruction: string
): Promise<LlmSubtitlePayload> {
  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetchWithTimeout(fetcher, url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${systemPrompt(instruction)}\n\n${buildPrompt(segments)}` }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: subtitleJsonSchema()
      }
    })
  });

  if (!response.ok) throw new Error(`Gemini request failed: ${response.status} ${await response.text()}`);

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = payload.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;
  return parseJsonPayload(text, "Gemini response did not include JSON text");
}

async function requestDeepSeekJson(
  model: string,
  apiKey: string,
  env: LlmEnv,
  segments: SubtitleSegment[],
  fetcher: typeof fetch,
  instruction: string
): Promise<LlmSubtitlePayload> {
  const response = await fetchWithTimeout(fetcher, openAiCompatibleChatUrl(env.LLM_BASE_URL), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt(instruction) },
        { role: "user", content: buildPrompt(segments) }
      ]
    })
  });

  if (!response.ok) throw new Error(`DeepSeek request failed: ${response.status} ${await response.text()}`);

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return parseJsonPayload(payload.choices?.[0]?.message?.content, "DeepSeek response did not include JSON text");
}

function openAiCompatibleChatUrl(baseUrl: string | undefined): string {
  const clean = baseUrl?.trim().replace(/\/+$/g, "");
  if (!clean) return `${DEEPSEEK_API_BASE}/chat/completions`;
  if (clean.endsWith("/chat/completions")) return clean;
  if (clean.endsWith("/v1")) return `${clean}/chat/completions`;
  return `${clean}/chat/completions`;
}

async function fetchWithTimeout(fetcher: typeof fetch, input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetcher(input, init),
      new Promise<Response>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`LLM request timed out after ${LLM_TIMEOUT_MS}ms`)), LLM_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseJsonPayload(text: string | undefined, emptyMessage: string): LlmSubtitlePayload {
  if (!text?.trim()) throw new Error(emptyMessage);
  const cleanText = stripCodeFence(text.trim());
  const payload = JSON.parse(cleanText) as LlmSubtitlePayload;
  if (!payload || !Array.isArray(payload.segments)) throw new Error("LLM JSON must include segments array");
  return payload;
}

function stripCodeFence(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1]!.trim() : text;
}

function mapValidatedSegments(originalSegments: SubtitleSegment[], payload: LlmSubtitlePayload): SubtitleSegment[] {
  const sourceById = new Map(originalSegments.map((segment) => [segment.index, segment]));
  const covered = new Set<number>();
  const polished: SubtitleSegment[] = [];
  let lastSourceId = 0;

  for (const item of payload.segments as LlmSubtitleSegment[]) {
    const sourceIds = validateSourceIds(item.sourceSegmentIds, sourceById, covered, lastSourceId);
    const text = typeof item.text === "string" ? normalizePolishedText(item.text) : "";
    if (!text) throw new Error("LLM segment text is empty");

    const sourceSegments = sourceIds.map((id) => sourceById.get(id)!);
    sourceIds.forEach((id) => covered.add(id));
    lastSourceId = sourceIds.at(-1)!;

    polished.push({
      index: polished.length + 1,
      startMs: sourceSegments[0]!.startMs,
      endMs: sourceSegments.at(-1)!.endMs,
      text,
      speaker: sourceSegments[0]?.speaker
    });
  }

  if (polished.length === 0) throw new Error("LLM returned no usable subtitle segments");
  assertOnlyDroppableSegmentsWereSkipped(originalSegments, covered);
  return polished;
}

function validateSourceIds(
  value: unknown,
  sourceById: Map<number, SubtitleSegment>,
  covered: Set<number>,
  lastSourceId: number
): number[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("sourceSegmentIds must be a non-empty array");
  const ids = value.map((id) => {
    if (!Number.isInteger(id)) throw new Error("sourceSegmentIds must contain integer ids");
    return id as number;
  });

  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index]!;
    const previousId = index === 0 ? lastSourceId : ids[index - 1]!;
    if (id <= previousId) throw new Error("sourceSegmentIds must be strictly increasing");
    if (!sourceById.has(id)) throw new Error(`Unknown source segment id: ${id}`);
    if (covered.has(id)) throw new Error(`Duplicate source segment id: ${id}`);
  }

  return ids;
}


function normalizeSubtitleBoundaries(segments: SubtitleSegment[]): SubtitleSegment[] {
  const normalized: SubtitleSegment[] = [];

  for (const segment of segments) {
    const match = segment.text.match(/^([,.;:!?，。！？、；：…]+)(.*)$/u);
    if (match && normalized.length > 0) {
      const previous = normalized[normalized.length - 1]!;
      previous.text = `${previous.text}${match[1]}`;
      previous.endMs = Math.max(previous.endMs, segment.startMs);

      const rest = match[2]!.trim();
      if (rest) normalized.push({ ...segment, text: rest });
      continue;
    }

    normalized.push({ ...segment });
  }

  return normalized.map((segment, index) => ({ ...segment, index: index + 1 }));
}

function normalizePolishedText(text: string): string {
  return normalizeChineseNumerals(normalizeSplitLatinWords(normalizePunctuationSpacing(text.trim()))).trim();
}

function normalizePunctuationSpacing(text: string): string {
  return text
    .replace(/\s+([,.;:!?，。！？、；：…])/g, "$1")
    .replace(/([，。！？、；：…])\s+/g, "$1")
    .replace(/([A-Za-z])([\u4e00-\u9fff])/gu, "$1 $2")
    .replace(/([\u4e00-\u9fff])([A-Za-z])/gu, "$1 $2")
    .replace(/\s{2,}/g, " ");
}

function normalizeSplitLatinWords(text: string): string {
  return text.replace(/\b[A-Za-z]{1,3}(?:\s+[A-Za-z]{1,3})+\b/g, (match) => {
    const pieces = match.trim().split(/\s+/);
    if (pieces.length < 2) return match;
    return pieces.join("");
  });
}

function normalizeChineseNumerals(text: string): string {
  return text.replace(/([第约大概将近近]?)([零〇一二两三四五六七八九十百千万亿]+)(个|元|块|号|次|年|月|日|点|分钟|秒|条|页|步|层|种|类|张|集|章|%|％)/gu, (match, prefix: string, numeral: string, unit: string, offset: number, fullText: string) => {
    if (!shouldUseArabicNumber({ prefix, numeral, unit, offset, fullText })) return match;
    const value = parseChineseInteger(numeral);
    if (value === null) return match;
    const cleanUnit = unit === "块" ? "元" : unit;
    return `${prefix}${value}${cleanUnit}`;
  });
}

function shouldUseArabicNumber(context: {
  prefix: string;
  numeral: string;
  unit: string;
  offset: number;
  fullText: string;
}): boolean {
  const { prefix, numeral, unit, offset, fullText } = context;
  const normalizedUnit = unit === "块" ? "元" : unit;
  if (normalizedUnit === "个" && /字段|记录|数据|项目|账号|账户|成员|人员|角色|类别|分类|科目/u.test(fullText) && !/^[一两二三]$/u.test(numeral)) return true;
  if (["元", "%", "％"].includes(normalizedUnit)) return true;
  if (["年", "月", "日", "点", "分钟", "秒"].includes(normalizedUnit)) return true;
  if (["号", "页"].includes(normalizedUnit)) return true;
  if (["条", "张", "集", "章"].includes(normalizedUnit) && !/^[一两二三]$/u.test(numeral)) return true;
  if (prefix === "第" && ["页", "步"].includes(normalizedUnit)) return true;

  const before = fullText.slice(Math.max(0, offset - 10), offset);
  const after = fullText.slice(offset, offset + numeral.length + unit.length + 10);
  if (/[A-Z]{2,}[_-]?$/i.test(before)) return true;
  if (/编号|单号|代码|编码|ID|id|页码|步骤|第\s*$/u.test(before)) return true;
  if (/记录|数据|金额|合计|总计|余额|预算|费用|付款|收款/u.test(before + after) && !/^[一两二三]$/u.test(numeral)) {
    return true;
  }

  return false;
}

function parseChineseInteger(input: string): number | null {
  if (/^[零〇一二两三四五六七八九]+$/u.test(input)) {
    return Number(Array.from(input).map((char) => chineseDigitValue(char)).join(""));
  }

  const value = parseChineseSectionedInteger(input);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseChineseSectionedInteger(input: string): number {
  const bigUnits = new Map([["亿", 100_000_000], ["万", 10_000]]);
  let total = 0;
  let rest = input;

  for (const [unit, multiplier] of bigUnits) {
    const index = rest.indexOf(unit);
    if (index >= 0) {
      const sectionText = rest.slice(0, index);
      const sectionValue = sectionText ? parseChineseSection(sectionText) : 1;
      total += sectionValue * multiplier;
      rest = rest.slice(index + 1);
    }
  }

  return total + parseChineseSection(rest);
}

function parseChineseSection(input: string): number {
  const unitValues = new Map([["千", 1000], ["百", 100], ["十", 10]]);
  let total = 0;
  let current: number | null = null;

  for (const char of Array.from(input)) {
    const unit = unitValues.get(char);
    if (unit) {
      total += (current ?? 1) * unit;
      current = null;
      continue;
    }

    const digit = chineseDigitValue(char);
    if (digit === null) return Number.NaN;
    current = digit;
  }

  return total + (current ?? 0);
}

function chineseDigitValue(char: string): number | null {
  const digits = new Map<string, number>([
    ["零", 0], ["〇", 0], ["一", 1], ["二", 2], ["两", 2], ["三", 3], ["四", 4],
    ["五", 5], ["六", 6], ["七", 7], ["八", 8], ["九", 9]
  ]);
  return digits.get(char) ?? null;
}

function stripTerminalSentencePunctuation(text: string): string {
  return text.replace(/[。！？.!?]+$/u, "");
}

function splitLongSegments(segments: SubtitleSegment[]): SubtitleSegment[] {
  const splitSegments = segments.flatMap(splitLongSegment);
  return splitSegments
    .map((segment) => ({ ...segment, text: stripSubtitleEdgePunctuation(segment.text) }))
    .filter((segment) => segment.text.length > 0)
    .map((segment, index) => ({ ...segment, index: index + 1 }));
}

function splitLongSegment(segment: SubtitleSegment): SubtitleSegment[] {
  const maxCharsPerSegment = 22;
  const chunks = chunkBySubtitleSentence(stripTerminalSentencePunctuation(segment.text), maxCharsPerSegment);
  if (chunks.length <= 1) return [segment];

  const totalChars = chunks.reduce((sum, chunk) => sum + countReadableChars(chunk), 0);
  const totalDuration = segment.endMs - segment.startMs;
  let cursorMs = segment.startMs;

  return chunks.map((chunk, index) => {
    const isLast = index === chunks.length - 1;
    const chunkDuration = isLast ? segment.endMs - cursorMs : Math.round(totalDuration * (countReadableChars(chunk) / totalChars));
    const startMs = cursorMs;
    const endMs = isLast ? segment.endMs : Math.min(segment.endMs, cursorMs + Math.max(chunkDuration, 250));
    cursorMs = endMs;
    return { ...segment, startMs, endMs, text: chunk.trim() };
  });
}

function chunkBySubtitleSentence(text: string, maxChars: number): string[] {
  const sentenceChunks = splitBySentencePunctuation(text);
  return sentenceChunks.flatMap((chunk) => (countReadableChars(chunk) > maxChars ? chunkByReadableChars(chunk, maxChars) : [chunk]));
}

function splitBySentencePunctuation(text: string): string[] {
  const chunks: string[] = [];
  let buffer = "";

  for (const char of Array.from(text.trim())) {
    buffer += char;
    if (isSentenceEndingPunctuation(char)) {
      chunks.push(buffer.trim());
      buffer = "";
    }
  }

  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks.length > 0 ? chunks : [text.trim()];
}

function chunkByReadableChars(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let rest = text.trim();

  while (countReadableChars(rest) > maxChars) {
    let splitIndex = chooseSplitIndex(rest, maxChars);

    chunks.push(rest.slice(0, splitIndex).trim());
    rest = rest.slice(splitIndex).trim();
  }

  if (rest) chunks.push(rest);
  return chunks;
}

function chooseSplitIndex(text: string, maxChars: number): number {
  const preferredBoundary = choosePreferredBoundaryIndex(text, maxChars);
  if (preferredBoundary > 0) return preferredBoundary;

  let readableCount = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (!/\s/.test(char)) readableCount += 1;

    if (readableCount >= maxChars) {
      return index + 1;
    }
  }

  return text.length;
}

function choosePreferredBoundaryIndex(text: string, maxChars: number): number {
  const maxOverflow = 8;
  const minChars = 6;
  const punctuationBoundary = collectBoundaryCandidates(collectPunctuationBoundaryIndexes(text), text, {
    maxChars,
    maxOverflow,
    minChars
  });
  const connectorBoundary = collectBoundaryCandidates(collectConnectorBoundaryIndexes(text), text, {
    maxChars,
    maxOverflow,
    minChars
  });

  return (
    lastBoundaryBeforeLimit(punctuationBoundary, maxChars) ??
    lastBoundaryBeforeLimit(connectorBoundary, maxChars) ??
    punctuationBoundary[0]?.index ??
    connectorBoundary[0]?.index ??
    -1
  );
}

type BoundaryOptions = {
  maxChars: number;
  maxOverflow: number;
  minChars: number;
};

function collectBoundaryCandidates(indexes: number[], text: string, options: BoundaryOptions): Array<{ index: number; chars: number }> {
  return indexes
    .map((index) => ({ index, chars: countReadableChars(text.slice(0, index)) }))
    .filter((boundary) => boundary.chars >= options.minChars && boundary.chars <= options.maxChars + options.maxOverflow);
}

function lastBoundaryBeforeLimit(boundaries: Array<{ index: number; chars: number }>, maxChars: number): number | undefined {
  return boundaries.filter((boundary) => boundary.chars <= maxChars).at(-1)?.index;
}

function collectPunctuationBoundaryIndexes(text: string): number[] {
  const boundaries = new Set<number>();

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (isSoftBoundaryPunctuation(char) || /\s/.test(char)) {
      boundaries.add(index + 1);
    }
  }

  return [...boundaries].sort((left, right) => left - right);
}

function collectConnectorBoundaryIndexes(text: string): number[] {
  const boundaries = new Set<number>();
  const connectorPattern = /然后|接着|之后|现在|进入|查看|点击|选择|打开|设置|叫|是|有/gu;
  for (const match of text.matchAll(connectorPattern)) {
    if (match.index && match.index > 0) {
      boundaries.add(match.index);
    }
  }

  return [...boundaries].sort((left, right) => left - right);
}

function takeLeadingPunctuation(text: string): string {
  return text.match(/^[,.;:!?，。！？、；：…]+/u)?.[0] ?? "";
}

function isSentenceEndingPunctuation(text: string): boolean {
  return /^[。！？!?]$/.test(text);
}

function isSoftBoundaryPunctuation(text: string): boolean {
  return /^[,.;:，、；：…]$/.test(text);
}

function countReadableChars(text: string): number {
  return Array.from(text.replace(/\s+/g, "")).length;
}

function stripSubtitleEdgePunctuation(text: string): string {
  return text
    .replace(/^[，。！？、；：,.!?;:\s]+/g, "")
    .replace(/[，。！？、；：,.!?;:\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function assertOnlyDroppableSegmentsWereSkipped(originalSegments: SubtitleSegment[], covered: Set<number>): void {
  for (const segment of originalSegments) {
    if (!covered.has(segment.index) && !isDroppableFiller(segment.text)) {
      throw new Error(`LLM skipped non-filler source segment: ${segment.index}`);
    }
  }
}

function isDroppableFiller(text: string): boolean {
  const normalized = text.replace(/[\s,.;:!?，。！？、；：…~～-]/g, "");
  return /^(?:呃|额|嗯|唔|呣|啊)+$/u.test(normalized);
}

function buildPrompt(segments: SubtitleSegment[]): string {
  return `请润色以下字幕段，返回严格 JSON，不要 Markdown。\n输入 segments：\n${JSON.stringify(
    segments.map((segment) => ({
      id: segment.index,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text
    }))
  )}`;
}

function systemPrompt(instruction: string): string {
  return [
    "你是视频字幕后处理器，只做忠实字幕润色。",
    "用户可配置润色要求如下：",
    instruction,
    "硬性约束：保留业务事实、金额、名称、步骤顺序；不扩写、不总结、不改变原意。",
    "硬性约束：sourceSegmentIds 只能引用输入 id；可以合并相邻的残缺短句，不允许创造没有来源的句子。",
    "只有纯口头禅段可以删除；不允许创造没有来源的句子。",
    "只返回 JSON：{\"segments\":[{\"sourceSegmentIds\":[1],\"text\":\"润色后的字幕\"}]}。"
  ].join("\n");
}

function subtitleJsonSchema(): Record<string, unknown> {
  return {
    type: "OBJECT",
    properties: {
      segments: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            sourceSegmentIds: {
              type: "ARRAY",
              items: { type: "integer" }
            },
            text: { type: "STRING" }
          },
          required: ["sourceSegmentIds", "text"]
        }
      }
    },
    required: ["segments"]
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
