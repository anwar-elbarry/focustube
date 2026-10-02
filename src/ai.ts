import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Cue, formatStamp, langName } from "./captions";

// ---------- Providers & settings ----------

export type ProviderId = "anthropic" | "openai" | "gemini" | "openrouter" | "custom";

export const PROVIDERS: {
  id: ProviderId;
  label: string;
  keyUrl: string | null;
  keyPlaceholder: string;
  /** Pre-filled model; users can pick any model their key can use. */
  defaultModel: string;
}[] = [
  {
    id: "anthropic",
    label: "Claude (Anthropic)",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyPlaceholder: "sk-ant-…",
    defaultModel: "claude-opus-5-5",
  },
  { id: "openai", label: "OpenAI", keyUrl: "https://platform.openai.com/api-keys", keyPlaceholder: "sk-…", defaultModel: "" },
  { id: "gemini", label: "Google Gemini", keyUrl: "https://aistudio.google.com/apikey", keyPlaceholder: "AIza…", defaultModel: "" },
  { id: "openrouter", label: "OpenRouter", keyUrl: "https://openrouter.ai/keys", keyPlaceholder: "sk-or-…", defaultModel: "" },
  {
    id: "custom",
    label: "Other / local (OpenAI-compatible)",
    keyUrl: null,
    keyPlaceholder: "Optional for local servers",
    defaultModel: "",
  },
];

export type AiConfig = {
  provider: ProviderId | "";
  model: string;
  baseUrl: string;
  /** Provider → masked key. The real key never reaches the page. */
  keyHints: Partial<Record<ProviderId, string>>;
};

export type Connection = {
  provider: ProviderId;
  model?: string;
  baseUrl?: string;
  /** undefined = keep the saved key, "" = remove it */
  apiKey?: string;
};

export const getAiConfig = () => invoke<AiConfig>("ai_get_config");
export const saveAiConfig = (args: Connection) => invoke<AiConfig>("ai_save_config", { args });
export const forgetAi = () => invoke<void>("ai_forget");
export const listModels = (args: Connection) =>
  invoke<{ id: string; name: string }[]>("ai_list_models", { args });
export const testAi = (args: Connection) => invoke<string>("ai_test", { args });
const complete = (system: string, prompt: string) => invoke<string>("ai_complete", { system, prompt });

/** True when a provider and model are saved (and a key, unless local). */
export function isAiReady(c: AiConfig | null): boolean {
  if (!c?.provider || !c.model) return false;
  return c.provider === "custom" || !!c.keyHints[c.provider];
}

/** Shared AI config; refreshes when settings are saved anywhere. */
export function useAiConfig() {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const refresh = useCallback(() => {
    getAiConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener("focustube-ai-config", refresh);
    return () => window.removeEventListener("focustube-ai-config", refresh);
  }, [refresh]);
  return { config, ready: isAiReady(config), refresh };
}

export const announceAiConfigChange = () => window.dispatchEvent(new Event("focustube-ai-config"));

// ---------- Prompts ----------

// Roughly 150k tokens: comfortably inside current models' context windows.
const MAX_TRANSCRIPT_CHARS = 600_000;

function transcriptText(cues: Cue[]): string {
  const text = cues.map((c) => `[${formatStamp(c.start)}] ${c.text.replace(/\n/g, " ")}`).join("\n");
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    // Say so rather than silently summarising half a video.
    throw new Error("This transcript is too long to send in one request.");
  }
  return text;
}

const uiLanguage = () => langName((navigator.language || "en").split("-")[0]);

export async function summarize(cues: Cue[], title: string): Promise<string> {
  const system =
    "You summarize video transcripts for someone deciding what to watch or reviewing what they watched. " +
    "Be accurate to the transcript and never invent content. Use timestamps exactly as they appear in the transcript, in [m:ss] or [h:mm:ss] form.";
  const prompt = `Video title: ${title}

Transcript (each line starts with its timestamp):
<transcript>
${transcriptText(cues)}
</transcript>

Write the summary in ${uiLanguage()}, in Markdown:
## Overview
Two or three sentences on what the video covers.
## Key points
5–8 bullet points with the most useful takeaways.
## Chapters
A bullet list of the main sections, each starting with its [timestamp], then a short title.`;
  return complete(system, prompt);
}

export async function askVideo(cues: Cue[], title: string, question: string): Promise<string> {
  const system =
    "You answer questions about a video using only its transcript. If the transcript doesn't contain the answer, say so plainly. " +
    "Cite where things are said with timestamps in [m:ss] or [h:mm:ss] form, exactly as they appear in the transcript. Keep answers concise.";
  const prompt = `Video title: ${title}

<transcript>
${transcriptText(cues)}
</transcript>

Question: ${question}

Answer in the language of the question, using Markdown.`;
  return complete(system, prompt);
}

// ---------- Translation ----------

const BATCH = 60;
const PARALLEL = 3;

export function parseLines(raw: string, expected: number): string[] | null {
  // Preferred: a JSON array of strings, possibly wrapped in a code fence.
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const arr = JSON.parse(raw.slice(start, end + 1));
      if (Array.isArray(arr) && arr.length === expected) return arr.map((s) => String(s ?? ""));
    } catch {
      /* fall through */
    }
  }
  // Fallback: numbered lines "1. …"
  const lines = raw
    .split("\n")
    .map((l) => l.match(/^\s*(\d+)[.)]\s*(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m);
  if (lines.length === expected) return lines.map((m) => m[2]);
  return null;
}

async function translateBatch(cues: Cue[], target: string): Promise<string[]> {
  const system =
    "You are a professional subtitle translator. Translate naturally and concisely, keeping each line short enough to read as a caption. " +
    "Keep names, code and technical terms as they are when that's what a viewer would expect.";
  const numbered = cues.map((c, i) => `${i + 1}. ${c.text.replace(/\n/g, " ")}`).join("\n");
  const prompt = `Translate these ${cues.length} numbered subtitle lines into ${target}.
Lines may be fragments of longer sentences; translate each line on its own so timing still matches.

${numbered}

Reply with only a JSON array of exactly ${cues.length} strings, in the same order.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = parseLines(await complete(system, prompt), cues.length);
    if (out) return out;
  }
  throw new Error("The model's translation didn't line up with the captions. Try again or pick another model.");
}

/** Translate captions in batches; returns new cues with the same timing. */
export async function translateCues(
  cues: Cue[],
  targetLang: string,
  onProgress: (done: number, total: number) => void
): Promise<Cue[]> {
  const target = langName(targetLang);
  const batches: Cue[][] = [];
  for (let i = 0; i < cues.length; i += BATCH) batches.push(cues.slice(i, i + BATCH));
  const results: string[][] = new Array(batches.length);
  let done = 0;
  let next = 0;
  onProgress(0, cues.length);
  async function worker() {
    while (next < batches.length) {
      const i = next++;
      results[i] = await translateBatch(batches[i], target);
      done += batches[i].length;
      onProgress(done, cues.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, batches.length) }, worker));
  const flat = results.flat();
  return cues.map((c, i) => ({ ...c, text: flat[i] || c.text }));
}
