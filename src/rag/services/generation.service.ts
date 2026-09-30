import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, Content } from '@google/generative-ai';
import { SearchHit } from './vector-store.service';
import { AskResponseDto, SourceRef } from '../dto/ask.dto';
import { PersonalContextService } from './personal-context.service';
import { ChatTurn } from './chat-history.service';

const SYSTEM_PROMPT = `You are Spendly's intelligent AI financial advisor.
You have access to two sources of context:
1. User Live Personal Financial Records (from the database: expenses by category, every individual loan (L1, L2, …), every individual investment (I1, I2, …), account balances, and net positions).
2. Curated Financial Knowledge Base (educational guides, loan policies, budgeting rules, debt repayment strategies).

Rules:
- If the question is about personal spending, a specific loan, a specific investment, debt position, SIP/RD growth, or monthly budget plans, use the User Live Personal Financial Records and calculate realistic projections or plans from their numbers. State all numbers clearly with rupee symbols (₹).
- When the user asks about a particular loan or investment, identify it by name (match loosely: "my HDFC RD", "the loan to Ravi") and answer with its exact figures and dates. If several match, list them; if none match, say which ones exist.
- This is a conversation: resolve follow-ups ("the second one", "what about that loan?") using the earlier messages.
- If the question is an educational or concept query (e.g. 50/30/20 rule, emergency funds, debt snowball vs avalanche), use the Knowledge Base excerpts and reference sources by their [number].
- If a value is missing from the records (e.g. no interest rate saved), say that it is not recorded instead of inventing it. If there are no loans or investments, say so, then give a clear hypothetical breakdown (e.g. formulas for clearing a target debt in 1 year, and SIP future value over 4-5 years assuming a standard 12% p.a. equity mutual fund CAGR).
- Be practical, highly structured, clear, and encouraging.`;

/** Previous messages are clipped so a long answer cannot crowd out the context. */
const MAX_HISTORY_CHARS = 1500;

type LlmMessage = { role: 'user' | 'assistant'; content: string };

@Injectable()
export class GenerationService {
  private readonly genAI: GoogleGenerativeAI;

  constructor(
    private readonly config: ConfigService,
    private readonly personalContext: PersonalContextService,
  ) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY') || '';
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  /**
   * [history] holds earlier turns of the same conversation (oldest first).
   * The personal records and knowledge-base excerpts are attached to the
   * newest question only, so they always reflect the current data.
   * Answers with `fallback: true` are degraded (AI unavailable) and should
   * not be stored in chat history.
   */
  async generate(
    question: string,
    hits: SearchHit[],
    userId?: string,
    history: ChatTurn[] = [],
  ): Promise<AskResponseDto & { fallback?: boolean }> {
    const personalContext = userId ? await this.personalContext.build(userId).catch(() => '') : '';

    const vectorContext = hits
      .map((h, i) => `[${i + 1}] Source: ${h.payload.title}\n${h.payload.text}`)
      .join('\n\n---\n\n');

    const combinedContextParts: string[] = [];
    if (personalContext) {
      combinedContextParts.push(personalContext);
    }
    if (vectorContext) {
      combinedContextParts.push(`[Knowledge Base Excerpts]\n${vectorContext}`);
    }

    if (combinedContextParts.length === 0) {
      return {
        answer:
          "I don't have grounded information or spending records for that query yet. Try asking about your average monthly spends, or financial topics like emergency funds and budgeting rules.",
        sources: [],
        grounded: false,
        fallback: true,
      };
    }

    const fullContext = combinedContextParts.join('\n\n====================\n\n');
    const prompt = `Provided Context:\n\n${fullContext}\n\nUser Question: ${question}\n\nAnswer the question directly using the provided context above.`;
    const priorTurns = this.toPriorTurns(history);

    const rawGroqKey = this.config.get<string>('GROQ_API_KEY') || process.env.GROQ_API_KEY;
    const groqApiKey = rawGroqKey ? rawGroqKey.replace(/^["']|["']$/g, '').trim() : undefined;
    const preferredProvider = this.config.get<string>('PREFERRED_AI_PROVIDER', groqApiKey ? 'groq' : 'gemini');

    // Scenario 1: Prefer Groq
    if (preferredProvider === 'groq' && groqApiKey) {
      try {
        const groqAnswer = await this.generateWithGroq(priorTurns, prompt, groqApiKey);
        return { answer: groqAnswer, sources: this.dedupeSources(hits), grounded: true };
      } catch (groqErr: any) {
        console.warn(`[GenerationService] Primary Groq generation failed (${groqErr.message}). Falling back to Gemini...`);
      }
    }

    // Scenario 2: Gemini (Primary or Fallback)
    try {
      const answerText = await this.generateWithGemini(priorTurns, prompt);
      return { answer: answerText, sources: this.dedupeSources(hits), grounded: true };
    } catch (geminiErr: any) {
      console.warn(`[GenerationService] Gemini generation failed (${geminiErr.message}). Checking secondary Groq...`);

      // Fallback to Groq if Gemini failed and it wasn't tried as primary
      if (preferredProvider !== 'groq' && groqApiKey) {
        try {
          const groqAnswer = await this.generateWithGroq(priorTurns, prompt, groqApiKey);
          return { answer: groqAnswer, sources: this.dedupeSources(hits), grounded: true };
        } catch (groqErr: any) {
          console.error('[GenerationService] Secondary Groq fallback also failed:', groqErr.message);
        }
      }

      const isRateLimit =
        geminiErr.status === 429 ||
        geminiErr.message?.includes('429') ||
        geminiErr.message?.includes('Quota exceeded');

      if (isRateLimit) {
        return {
          answer: `⚠️ **Gemini AI Rate Limit Reached (HTTP 429)**\n\nYour Gemini daily quota has been reached.\n\n**Quick Fix:** Add \`GROQ_API_KEY=gsk_...\` in \`.env\` from [Groq Console](https://console.groq.com) for 14,400 free requests/day!\n\n---\n\n### Your Financial Data from Database:\n\n${personalContext}`,
          sources: [],
          grounded: false,
          fallback: true,
        };
      }

      if (personalContext && /spend|expense|average|loan|debt|sip|rd|invest|fd/i.test(question)) {
        return {
          answer: `⚠️ **AI Generation Notice (${geminiErr.message || 'Error'})**\n\nHere is your current financial summary retrieved from your database:\n\n${personalContext}`,
          sources: [],
          grounded: true,
          fallback: true,
        };
      }

      throw geminiErr;
    }
  }

  /** Clips earlier turns and makes sure they start with a user message. */
  private toPriorTurns(history: ChatTurn[]): LlmMessage[] {
    const turns = history.map((t) => ({
      role: t.role,
      content: t.content.length > MAX_HISTORY_CHARS ? `${t.content.slice(0, MAX_HISTORY_CHARS)}…` : t.content,
    }));
    while (turns.length > 0 && turns[0].role !== 'user') turns.shift();
    return turns;
  }

  private async generateWithGemini(priorTurns: LlmMessage[], prompt: string): Promise<string> {
    const modelName = this.config.get<string>('GEMINI_MODEL', 'gemini-3.6-flash');
    const model = this.genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_PROMPT,
    });
    const contents: Content[] = [
      ...priorTurns.map((t) => ({
        role: t.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: t.content }],
      })),
      { role: 'user', parts: [{ text: prompt }] },
    ];

    const maxAttempts = 2;
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await model.generateContent({ contents });
        return result.response.text();
      } catch (err: any) {
        if ((err.status === 503 || err.message?.includes('503')) && attempt < maxAttempts) {
          console.warn(`[GenerationService] Gemini API 503 on attempt ${attempt}/${maxAttempts}, retrying...`);
          await new Promise((resolve) => setTimeout(resolve, 1500));
        } else {
          throw err;
        }
      }
    }
  }

  private async generateWithGroq(priorTurns: LlmMessage[], prompt: string, groqApiKey: string): Promise<string> {
    const groqModel = this.config.get<string>('GROQ_MODEL', 'openai/gpt-oss-120b');
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: groqModel,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...priorTurns,
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq API error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || 'No response generated from Groq.';
  }

  private dedupeSources(hits: SearchHit[]): SourceRef[] {
    const seen = new Map<string, SourceRef>();
    for (const h of hits) {
      const existing = seen.get(h.payload.sourceId);
      if (!existing || h.score > existing.score) {
        seen.set(h.payload.sourceId, {
          docId: h.payload.docId,
          title: h.payload.title,
          category: h.payload.category,
          score: Math.round(h.score * 1000) / 1000,
        });
      }
    }
    return [...seen.values()].sort((a, b) => b.score - a.score);
  }
}
