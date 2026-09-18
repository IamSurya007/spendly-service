import { Injectable, Optional, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { SearchHit } from './vector-store.service';
import { AskResponseDto, SourceRef } from '../dto/ask.dto';
import { ExpensesService } from '../../expenses/expenses.service';
import { LoansService } from '../../loans/loans.service';
import { InvestmentsService } from '../../investments/investments.service';

const SYSTEM_PROMPT = `You are Spendly's intelligent AI financial advisor.
You have access to two sources of context:
1. User Live Personal Financial Records (from PostgreSQL database: actual user expenses, monthly totals, category breakdowns, active loans/debts owed, investments, and net positions).
2. Curated Financial Knowledge Base (educational guides, loan policies, budgeting rules, debt repayment strategies).

Rules:
- If the question is about personal spending, debt position, loans owed, SIP/investment growth, or monthly budget clearance plans, use the User Live Personal Financial Records context and calculate realistic projections or plans based on their numbers. State all numbers clearly with rupee symbols (₹).
- If the question is an educational or concept query (e.g. 50/30/20 rule, emergency funds, debt snowball vs avalanche), use the Knowledge Base context excerpts and reference sources by their [number].
- If specific numbers (like loan balance) are zero or missing in personal context, state that no active debt is registered in the database, then provide a clear hypothetical breakdown (e.g., formulas for clearing a target debt in 1 year, and SIP future value calculations over 4-5 years assuming standard 12% p.a. equity mutual fund CAGR).
- Be practical, highly structured, clear, and encouraging.`;

@Injectable()
export class GenerationService {
  private readonly genAI: GoogleGenerativeAI;

  constructor(
    private readonly config: ConfigService,
    private readonly expensesService: ExpensesService,
    @Optional() private readonly loansService?: LoansService,
    @Optional() private readonly investmentsService?: InvestmentsService,
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

    const modelName = this.config.get<string>('GEMINI_MODEL', 'gemini-2.0-flash');
    const model = this.genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_PROMPT,
    });

    const prompt = `Provided Context:\n\n${fullContext}\n\nUser Question: ${question}\n\nAnswer the question directly using the provided context above.`;

    try {
      let answerText = '';
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          attempts++;
          const result = await model.generateContent(prompt);
          answerText = result.response.text();
          break;
        } catch (err: any) {
          if ((err.status === 503 || err.message?.includes('503')) && attempts < maxAttempts) {
            console.warn(`[GenerationService] Gemini API 503 on attempt ${attempts}/${maxAttempts}, retrying in 1.5s...`);
            await new Promise((resolve) => setTimeout(resolve, 1500));
          } else {
            throw err;
          }
        }
      }

      const sources: SourceRef[] = this.dedupeSources(hits);
      return { answer: answerText, sources, grounded: true };
    } catch (err: any) {
      console.error('[GenerationService] Gemini generateContent failed:', err);

      const isRateLimit = err.status === 429 || err.message?.includes('429') || err.message?.includes('Quota exceeded');
      if (isRateLimit) {
        return {
          answer: `⚠️ **Gemini AI Rate Limit Reached (HTTP 429)**\n\nThe free tier quota for \`${modelName}\` has been reached for today on your current API key.\n\nTo restore full AI reasoning, please update your \`GEMINI_API_KEY\` in \`.env\` with a fresh API key from [Google AI Studio](https://aistudio.google.com/app/apikey).\n\n---\n\n### Your Raw Financial Data (from Database):\n\n${personalContext}`,
          sources: [],
          grounded: false,
        };
      }

      if (personalContext && /spend|expense|average|loan|debt|sip/i.test(question)) {
        return {
          answer: `⚠️ **AI Generation Unavailable (${err.message || 'Service Error'})**\n\nHere is your current financial summary retrieved from your database:\n\n${personalContext}`,
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

      const loansSummary = this.loansService
        ? await this.loansService.getSummary(userId).catch(() => null)
        : null;

      const investmentsSummary = this.investmentsService
        ? await this.investmentsService.getSummary(userId).catch(() => null)
        : null;

      let contextStr = `[User Live Personal Financial Records from PostgreSQL Database]\n`;

      if (validSummaries.length > 0) {
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
        contextStr += `Expenses Summary:\n- Overall 3-Month Average Spend: ₹${avgMonthlySpend.toLocaleString('en-IN')}/month\n- Monthly Breakdowns:\n${lines.join('\n')}\n`;
      } else {
        contextStr += `Expenses Summary: No positive expense records found in database.\n`;
      }

      if (loansSummary) {
        contextStr += `Loans & Debt Position:\n- Total Debt Owed (Loans Taken): ₹${Math.round(loansSummary.totalOwed).toLocaleString('en-IN')}\n- Total Receivables (Loans Given): ₹${Math.round(loansSummary.totalToReceive).toLocaleString('en-IN')}\n- Net Position: ₹${Math.round(loansSummary.netPosition).toLocaleString('en-IN')}\n`;
        if (loansSummary.upcomingRepayments && loansSummary.upcomingRepayments.length > 0) {
          const list = loansSummary.upcomingRepayments
            .map((r) => `  * ${r.name} (${r.type}): ₹${r.total.toLocaleString('en-IN')} due on ${r.repaymentDate}`)
            .join('\n');
          contextStr += `Upcoming Loan Repayments:\n${list}\n`;
        }
      }

      if (investmentsSummary) {
        contextStr += `Investments Summary:\n- Total Invested: ₹${Math.round(investmentsSummary.totalInvested).toLocaleString('en-IN')}\n- Total Expected Maturity Value: ₹${Math.round(investmentsSummary.totalMaturityValue).toLocaleString('en-IN')}\n`;
      }

      return contextStr;
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
