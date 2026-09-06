import Anthropic from '@anthropic-ai/sdk';
import { nanoid } from 'nanoid';
import { env } from '../env.js';
import type { QuestionInput } from '../game/questions.js';

/**
 * AI PDF quiz EXTRACTION (Section 8) — extraction only, never generation.
 *
 * The quiz already exists in the PDF. Claude's job is strictly to DETECT and return
 * the questions/options/answer-key already written there. The system prompt forbids
 * inventing, rephrasing, adding, or removing any content; missing correct answers are
 * returned null rather than guessed.
 *
 * "Handle both" PDF strategy (per project decision):
 *  - Extract embedded text with pdf.js. If the document has usable text, send that
 *    text to Claude (cheapest path).
 *  - If text is sparse/empty (a scanned/image PDF), send the PDF itself as a document
 *    block — Claude reads scanned pages natively via its PDF/vision support, so no
 *    local OCR/canvas dependency is required.
 */

const anthropic = new Anthropic({ apiKey: env.anthropic.apiKey });

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: 'return_extracted_quiz',
  description: 'Return the quiz questions exactly as they already appear in the document.',
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The question text, verbatim.' },
            options: {
              type: 'array',
              items: { type: 'string' },
              description:
                'The options exactly as written. Do not add, remove, rephrase, or invent options.',
            },
            correctOptionIndex: {
              type: ['integer', 'null'],
              description:
                'Zero-based index of the correct option IF the document marks one (answer key, bold, star, etc.). Otherwise null — never guess.',
            },
          },
          required: ['text', 'options', 'correctOptionIndex'],
        },
      },
    },
    required: ['questions'],
  },
};

const SYSTEM_PROMPT = `You are a strict extraction tool. The user provides a document that ALREADY CONTAINS a complete quiz written by a human. Your ONLY job is to detect and transcribe the questions, their options, and any marked correct answers EXACTLY as they appear.

Hard rules:
- Do NOT invent, write, generate, rephrase, translate, summarize, or "improve" any question, option, or answer.
- Transcribe options verbatim. Do NOT add a missing option, remove one, or normalise their number — if a question has 2 or 3 options, return 2 or 3.
- Only set correctOptionIndex when the document itself marks the correct answer (an answer key, bolding, a star/asterisk, "Ans:", etc.). If you cannot find a marked answer, return null. Never guess.
- If a block of text is not clearly a quiz question with options, omit it.
Return your result ONLY by calling the return_extracted_quiz tool.`;

interface RawQuestion {
  text: string;
  options: string[];
  correctOptionIndex: number | null;
}

/** Extract embedded text from a PDF buffer using pdf.js (legacy build for Node). */
async function extractPdfText(buffer: Buffer): Promise<string> {
  // pdfjs-dist legacy build works in Node without a DOM.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items.map((it) => ('str' in it ? it.str : '')).join(' ');
    parts.push(line);
  }
  return parts.join('\n\n').trim();
}

export interface ExtractionResult {
  mode: 'text' | 'pdf_vision';
  questions: QuestionInput[];
}

export async function extractQuizFromPdf(buffer: Buffer): Promise<ExtractionResult> {
  if (!env.anthropic.apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured; AI extraction is unavailable.');
  }

  const text = await extractPdfText(buffer).catch(() => '');
  // Heuristic: enough characters to be a real text layer, else treat as scanned.
  const isTextBased = text.replace(/\s/g, '').length > 40;

  const content: Anthropic.MessageParam['content'] = isTextBased
    ? [
        {
          type: 'text',
          text: `Extract the existing quiz from this document text:\n\n<document>\n${text}\n</document>`,
        },
      ]
    : [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') },
        },
        { type: 'text', text: 'Extract the existing quiz from this document (it may be scanned).' },
      ];

  const msg = await anthropic.messages.create({
    model: env.anthropic.model,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: 'tool', name: 'return_extracted_quiz' },
    messages: [{ role: 'user', content }],
  });

  const toolUse = msg.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
  if (!toolUse) throw new Error('AI did not return structured output.');

  const raw = (toolUse.input as { questions: RawQuestion[] }).questions ?? [];
  const questions: QuestionInput[] = raw
    .filter((q) => q.text?.trim() && Array.isArray(q.options) && q.options.length >= 2)
    .map((q) => {
      const options = q.options.map((t) => ({ id: nanoid(8), text: t }));
      const correctOptionId =
        q.correctOptionIndex != null && q.correctOptionIndex >= 0 && q.correctOptionIndex < options.length
          ? options[q.correctOptionIndex].id
          : null;
      return {
        text: q.text.trim(),
        media: [],
        options,
        correctOptionId,
        correctPoints: null,
        wrongPenalty: null,
        timeLimitSec: null,
        hint: null,
        hintCost: 0,
        source: 'ai_pdf' as const,
      };
    });

  return { mode: isTextBased ? 'text' : 'pdf_vision', questions };
}
