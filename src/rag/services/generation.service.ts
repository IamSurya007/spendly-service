import { Injectable, Optional } from '@nestjs/common';
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
    const prompt = `Provided Context:\n\n${fullContext}\n\nUser Question: ${question}\n\nAnswer the question directly using the provided context above.`;

    const rawGroqKey = this.config.get<string>('GROQ_API_KEY') || process.env.GROQ_API_KEY;
    const groqApiKey = rawGroqKey ? rawGroqKey.replace(/^["']|["']$/g, '').trim() : undefined;
    const preferredProvider = this.config.get<string>('PREFERRED_AI_PROVIDER', groqApiKey ? 'groq' : 'gemini');

    // Scenario 1: Prefer Groq
    if (preferredProvider === 'groq' && groqApiKey) {
      try {
        const groqAnswer = await this.generateWithGroq(prompt, groqApiKey);
        const sources: SourceRef[] = this.dedupeSources(hits);
        return { answer: groqAnswer, sources, grounded: true };
      } catch (groqErr: any) {
        console.warn(`[GenerationService] Primary Groq generation failed (${groqErr.message}). Falling back to Gemini...`);
      }
    }

    // Scenario 2: Gemini (Primary or Fallback)
    try {
      const modelName = this.config.get<string>('GEMINI_MODEL', 'gemini-3.6-flash');
      const model = this.genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: SYSTEM_PROMPT,
      });

      let answerText = '';
      let attempts = 0;
      const maxAttempts = 2;

      while (attempts < maxAttempts) {
        try {
          attempts++;
          const result = await model.generateContent(prompt);
          answerText = result.response.text();
          break;
        } catch (err: any) {
          if ((err.status === 503 || err.message?.includes('503')) && attempts < maxAttempts) {
            console.warn(`[GenerationService] Gemini API 503 on attempt ${attempts}/${maxAttempts}, retrying...`);
            await new Promise((resolve) => setTimeout(resolve, 1500));
          } else {
            throw err;
          }
        }
      }

      const sources: SourceRef[] = this.dedupeSources(hits);
      return { answer: answerText, sources, grounded: true };
    } catch (geminiErr: any) {
      console.warn(`[GenerationService] Gemini generation failed (${geminiErr.message}). Checking secondary Groq...`);

      // Fallback to Groq if Gemini failed and it wasn't tried as primary
      if (preferredProvider !== 'groq' && groqApiKey) {
        try {
          const groqAnswer = await this.generateWithGroq(prompt, groqApiKey);
          const sources: SourceRef[] = this.dedupeSources(hits);
          return { answer: groqAnswer, sources, grounded: true };
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
        };
      }

      if (personalContext && /spend|expense|average|loan|debt|sip/i.test(question)) {
        return {
          answer: `⚠️ **AI Generation Notice (${geminiErr.message || 'Error'})**\n\nHere is your current financial summary retrieved from your database:\n\n${personalContext}`,
          sources: [],
          grounded: true,
        };
      }

      throw geminiErr;
    }
  }

  private async generateWithGroq(prompt: string, groqApiKey: string): Promise<string> {
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
