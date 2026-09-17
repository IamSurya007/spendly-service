import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { SearchHit } from './vector-store.service';
import { AskResponseDto, SourceRef } from '../dto/ask.dto';
import { ExpensesService } from '../../expenses/expenses.service';

const SYSTEM_PROMPT = `You are Spendly's intelligent AI financial advisor.
You have access to two sources of context:
1. User Live Personal Financial Records (from PostgreSQL database: actual user expenses, monthly totals, category breakdowns, averages).
2. Curated Financial Knowledge Base (educational guides, loan policies, budgeting rules).

Rules:
- If the question is about personal spending, monthly averages, expenses, or budgets, use the User Live Personal Financial Records context. State numbers clearly with rupee symbols (₹) and monthly breakdowns.
- If the question is an educational or concept query (e.g. 50/30/20 rule, emergency funds, debt snowball), use the Knowledge Base context excerpts and reference sources by their [number].
- If the context doesn't contain enough information to answer, state so plainly and suggest relevant questions.
- Be clear, practical, helpful, and concise.`;

@Injectable()
export class GenerationService {
  private readonly genAI: GoogleGenerativeAI;

  constructor(
    private readonly config: ConfigService,
    private readonly expensesService: ExpensesService,
  ) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY') || '';
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async generate(question: string, hits: SearchHit[], userId?: string): Promise<AskResponseDto> {
    const personalContext = userId ? await this.getPersonalFinancialContext(userId) : '';

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
      };
    }

    const fullContext = combinedContextParts.join('\n\n====================\n\n');

    const model = this.genAI.getGenerativeModel({
      model: 'gemini-3.6-flash',
      systemInstruction: SYSTEM_PROMPT,
    });

    const prompt = `Provided Context:\n\n${fullContext}\n\nUser Question: ${question}\n\nAnswer the question directly using the provided context above.`;

    try {
      const result = await model.generateContent(prompt);
      const answer = result.response.text();
      const sources: SourceRef[] = this.dedupeSources(hits);

      return { answer, sources, grounded: true };
    } catch (err: any) {
      console.error('[GenerationService] Gemini generateContent failed:', err);
      // Fallback response if AI generation fails
      if (personalContext && /spend|expense|average/i.test(question)) {
        return {
          answer: `Based on your records in the database, here is your summary:\n\n${personalContext}`,
          sources: [],
          grounded: true,
        };
      }
      throw err;
    }
  }

  private async getPersonalFinancialContext(userId: string): Promise<string> {
    try {
      const now = new Date();
      const monthsToFetch: string[] = [];
      for (let i = 0; i < 3; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthsToFetch.push(ym);
      }

      const summaries = await Promise.all(
        monthsToFetch.map((m) => this.expensesService.getSummary(userId, m).catch(() => null))
      );

      const validSummaries = summaries.filter(
        (s): s is NonNullable<typeof s> => s !== null && s.totalExpenses > 0
      );

      if (validSummaries.length === 0) {
        return 'User Live Personal Financial Records: No positive expense records found in database.';
      }

      let totalSpendSum = 0;
      const lines: string[] = [];

      for (const s of validSummaries) {
        totalSpendSum += s.totalExpenses;
        const topCats = (s.byCategory || [])
          .sort((a, b) => b.total - a.total)
          .slice(0, 4)
          .map((c) => `${c.category}: ₹${Math.round(c.total).toLocaleString('en-IN')}`)
          .join(', ');

        lines.push(
          `- ${s.month}: Total Spend ₹${Math.round(s.totalExpenses).toLocaleString('en-IN')} (Top Categories: ${topCats || 'None'})`
        );
      }

      const avgMonthlySpend = Math.round(totalSpendSum / validSummaries.length);

      return `[User Live Personal Financial Records from PostgreSQL Database]\nUser ID: ${userId}\nOverall 3-Month Average Spend: ₹${avgMonthlySpend.toLocaleString('en-IN')}/month\nMonthly Breakdowns:\n${lines.join('\n')}`;
    } catch (err: any) {
      console.warn('[GenerationService] Failed to load personal financial context:', err.message);
      return '';
    }
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
