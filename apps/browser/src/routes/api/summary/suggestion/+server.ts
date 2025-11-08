import { json } from "@sveltejs/kit";
import { OPENAI_API_KEY } from "$env/static/private";

import type { RequestHandler } from "./$types";
import { createOpenAIClient } from "$lib/server/openai";
import {
  buildSummarySuggestionResponseFormat,
  parseSummarySuggestionText,
} from "$lib/server/summarySuggestion";

const SUMMARY_INSTRUCTIONS = [
  "あなたは日報の Markdown サマリを共同編集するアシスタントです。",
  "- 役割: 編集者として、ユーザーの入力を尊重しつつサマリ文書の品質を高めること",
  "- トーン: 丁寧で簡潔（必要十分な説明に留める）",
  "- 目的: summary_update と assistant_message を JSON Schema に従って必ず生成すること",
  "- 良い応答例: summary_update.mode を適切に選び、content には Markdown の差分本文のみを含める。assistant_message では提案理由と次のアクションを短く示す",
  "- 悪い応答例: schema にないフィールドを追加する、content に差分以外の説明を混在させる、assistant_message を空にする",
].join("\n");

type SuggestionRequestBody = {
  model?: unknown;
  prompt?: unknown;
  content?: unknown;
  selection?: unknown;
  previousResponseId?: unknown;
};

type SummarySelection = {
  start: number;
  end: number;
  content: string;
} | null;

export const POST: RequestHandler = async ({ request }) => {
  const body = await readRequestBody(request);
  if (!body.ok) {
    return json({ error: body.error }, { status: 400 });
  }

  if (!OPENAI_API_KEY || OPENAI_API_KEY.trim().length === 0) {
    return json({ error: "OpenAI API キーが設定されていません。" }, { status: 503 });
  }

  try {
    const client = await createOpenAIClient({ apiKey: OPENAI_API_KEY });
    const response = await client.responses.create({
      model: body.value.model,
      response_format: buildSummarySuggestionResponseFormat(),
      instructions: SUMMARY_INSTRUCTIONS,
      previous_response_id: body.value.previousResponseId ?? undefined,
      input: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildUserPrompt(body.value.prompt, body.value.content, body.value.selection),
            },
          ],
        },
      ],
    });

    const structuredText = extractStructuredText(response);
    const suggestion = parseSummarySuggestionText(structuredText);
    const responseId = readResponseId(response);

    return json(
      {
        summaryUpdate: suggestion.summaryUpdate,
        assistantMessage: suggestion.assistantMessage,
        reasoning: suggestion.reasoning,
        responseId,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("summary suggestion failed", error);
    return json(
      { error: "サマリ提案の生成に失敗しました。" },
      {
        status: 502,
      }
    );
  }
};

async function readRequestBody(request: Request): Promise<
  | {
      ok: true;
      value: {
        model: string;
        prompt: string;
        content: string;
        selection: SummarySelection;
        previousResponseId: string | null;
      };
    }
  | { ok: false; error: string }
> {
  let payload: SuggestionRequestBody;
  try {
    payload = (await request.json()) as SuggestionRequestBody;
  } catch {
    return { ok: false, error: "JSON 形式でリクエストしてください。" };
  }

  const model = typeof payload.model === "string" ? payload.model.trim() : "";
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  const content = typeof payload.content === "string" ? payload.content : "";
  const selection = normalizeSelection(payload.selection);
  const previousResponseId =
    typeof payload.previousResponseId === "string" && payload.previousResponseId.trim().length > 0
      ? payload.previousResponseId.trim()
      : null;

  if (!model || !prompt) {
    return { ok: false, error: "model と prompt は必須です。" };
  }

  return {
    ok: true,
    value: {
      model,
      prompt,
      content,
      selection,
      previousResponseId,
    },
  };
}

function buildUserPrompt(prompt: string, content: string, selection: SummarySelection): string {
  const sections = ["# User Prompt", prompt.trim() || "(empty)", ""];
  if (selection && selection.content.trim().length > 0) {
    sections.push("# Selected Summary Section");
    sections.push(selection.content);
    sections.push("");
  }
  sections.push("# Current Summary");
  sections.push(content);
  return sections.join("\n");
}

function extractStructuredText(response: unknown): string {
  if (!response || typeof response !== "object") {
    throw new Error("OpenAI 応答が空です。");
  }

  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    throw new Error("OpenAI 応答に output が含まれていません。");
  }

  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const chunk of content) {
      if (chunk && typeof chunk === "object") {
        const type = (chunk as { type?: unknown }).type;
        const text = (chunk as { text?: unknown }).text;
        if (typeof text === "string" && (type === "output_text" || type === "text" || !type)) {
          return text;
        }
      }
    }
  }

  throw new Error("OpenAI 応答から structured output を抽出できませんでした。");
}

function readResponseId(response: unknown): string | null {
  if (!response || typeof response !== "object") {
    return null;
  }
  const rawId = (response as { id?: unknown }).id;
  if (typeof rawId === "string" && rawId.trim().length > 0) {
    return rawId;
  }
  return null;
}

function normalizeSelection(input: unknown): SummarySelection {
  if (!input || typeof input !== "object") {
    return null;
  }
  const record = input as Record<string, unknown>;
  const start = parseIndex(record.start);
  const end = parseIndex(record.end);
  if (start === null || end === null) {
    return null;
  }
  if (end <= start) {
    return null;
  }
  const content =
    typeof record.content === "string"
      ? record.content
      : Array.isArray(record.content)
        ? record.content.join("\n")
        : "";
  return {
    start,
    end,
    content,
  };
}

function parseIndex(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return null;
}
