import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../../database/entities/account.entity';
import { Loan } from '../../database/entities/loan.entity';
import { Investment } from '../../database/entities/investment.entity';
import { LoanStatus, LoanType, InvestmentType } from '../../database/enums';
import { ExpensesService } from '../../expenses/expenses.service';
import { LoansService } from '../../loans/loans.service';
import { InvestmentsService } from '../../investments/investments.service';

/** Max items listed per section; the rest are summarised in one line. */
export const MAX_ITEMS_PER_SECTION = 25;

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().substring(0, 10) : null);
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfToday(now: Date): Date {
  const t = new Date(now);
  t.setHours(0, 0, 0, 0);
  return t;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfToday(to).getTime() - startOfToday(from).getTime()) / DAY_MS);
}

/** Whole months from [start] to [now], counting the start month as the first installment. */
export function installmentsPaid(start: Date, now: Date, durationMonths: number): number {
  if (now < start) return 0;
  const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + (now.getDate() >= start.getDate() ? 1 : 0);
  return Math.max(0, Math.min(durationMonths || months, months));
}

export function describeLoan(loan: Loan, index: number, now: Date): string {
  const direction = loan.type === LoanType.TAKEN ? 'borrowed — you owe' : 'lent — owed to you';
  const parts = [
    `L${index}. ${loan.name} (${direction})`,
    `principal ${inr(loan.principal)}`,
    `total to repay ${inr(loan.total)}`,
  ];
  if (loan.interestRate) parts.push(`interest ${loan.interestRate}% p.a.`);
  if (loan.repaymentDate) {
    const due = new Date(loan.repaymentDate);
    const d = daysBetween(now, due);
    const when = d < 0 ? `${-d} days overdue` : d === 0 ? 'due today' : `due in ${d} days`;
    parts.push(`repayment date ${day(due)} (${when})`);
  } else {
    parts.push('no repayment date set');
  }
  parts.push(`status ${loan.status}`);
  if (loan.notes) parts.push(`notes: "${loan.notes.replace(/\s+/g, ' ').slice(0, 120)}"`);
  return `- ${parts.join('; ')}`;
}

export function describeInvestment(inv: Investment, index: number, now: Date): string {
  const start = new Date(inv.startDate);
  const maturity = new Date(inv.maturityDate);
  const parts = [`I${index}. ${inv.name} (${inv.type}${inv.institution ? `, ${inv.institution}` : ''})`];

  const recurring = inv.type === InvestmentType.RD || inv.type === InvestmentType.SIP;
  if (recurring && inv.monthlyAmount > 0) {
    const paid = installmentsPaid(start, now, inv.durationMonths);
    parts.push(`${inr(inv.monthlyAmount)}/month for ${inv.durationMonths} months`);
    parts.push(`${paid} installments so far ≈ ${inr(paid * inv.monthlyAmount)} invested`);
    parts.push(`total planned ${inr(inv.monthlyAmount * inv.durationMonths)}`);
  } else {
    parts.push(`invested ${inr(inv.principal)}`);
  }
  if (inv.interestRate) parts.push(`rate ${inv.interestRate}% p.a.`);
  parts.push(`expected maturity value ${inr(inv.maturityAmount)}`);
  parts.push(`started ${day(start)}`);

  const d = daysBetween(now, maturity);
  if (d < 0) {
    parts.push(`matured on ${day(maturity)}`);
  } else {
    const months = Math.round(d / 30.44);
    parts.push(`matures ${day(maturity)} (${months >= 1 ? `~${months} months` : `${d} days`} left)`);
  }
  return `- ${parts.join('; ')}`;
}

/**
 * Builds the "[User Live Personal Financial Records]" block of the prompt from
 * live database state: spending by category, and every loan, investment and
 * account individually so the assistant can answer about a specific one.
 */
@Injectable()
export class PersonalContextService {
  constructor(
    private readonly expensesService: ExpensesService,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @Optional() private readonly loansService?: LoansService,
    @Optional() private readonly investmentsService?: InvestmentsService,
  ) {}

  async build(userId: string, now = new Date()): Promise<string> {
    const [expenses, loans, investments, accounts] = await Promise.all([
      this.expensesSection(userId, now).catch(() => ''),
      this.loansSection(userId, now).catch(() => ''),
      this.investmentsSection(userId, now).catch(() => ''),
      this.accountsSection(userId).catch(() => ''),
    ]);
    return [
      '[User Live Personal Financial Records from PostgreSQL Database]',
      `Today is ${day(now)}.`,
      expenses,
      loans,
      investments,
      accounts,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async expensesSection(userId: string, now: Date): Promise<string> {
    const months: string[] = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const summaries = (
      await Promise.all(months.map((m) => this.expensesService.getSummary(userId, m).catch(() => null)))
    ).filter((s): s is NonNullable<typeof s> => s !== null && s.totalExpenses > 0);

    if (summaries.length === 0) {
      return 'Expenses Summary: No positive expense records found in database.';
    }

    const total = summaries.reduce((s, m) => s + m.totalExpenses, 0);
    const lines = summaries.map((s) => {
      const top = (s.byCategory || [])
        .slice(0, 5)
        .map((c) => {
          const subs = (c.subcategories || [])
            .slice(0, 3)
            .map((sc) => `${sc.subcategory} ${inr(sc.total)}`)
            .join(', ');
          return `${c.category}: ${inr(c.total)}${subs ? ` (${subs})` : ''}`;
        })
        .join('; ');
      return `- ${s.month}: Total Spend ${inr(s.totalExpenses)} (Top Categories: ${top || 'None'})`;
    });
    return [
      'Expenses Summary:',
      `- Overall 3-Month Average Spend: ${inr(total / summaries.length)}/month`,
      '- Monthly Breakdowns:',
      ...lines,
    ].join('\n');
  }

  private async loansSection(userId: string, now: Date): Promise<string> {
    if (!this.loansService) return '';
    const all = await this.loansService.findAll(userId);
    const open = all.filter((l) => l.status !== LoanStatus.PAID);
    const paid = all.length - open.length;

    if (all.length === 0) return 'Loans: No loans recorded.';

    const owed = open.filter((l) => l.type === LoanType.TAKEN).reduce((s, l) => s + l.total, 0);
    const receivable = open.filter((l) => l.type === LoanType.GIVEN).reduce((s, l) => s + l.total, 0);

    // Soonest (or most overdue) repayment first; undated loans last.
    const sorted = [...open].sort((a, b) => {
      const ad = a.repaymentDate ? new Date(a.repaymentDate).getTime() : Infinity;
      const bd = b.repaymentDate ? new Date(b.repaymentDate).getTime() : Infinity;
      return ad - bd;
    });
    const listed = sorted.slice(0, MAX_ITEMS_PER_SECTION);

    const lines = [
      'Loans & Debt Position:',
      `- Total you owe (loans taken): ${inr(owed)}`,
      `- Total owed to you (loans given): ${inr(receivable)}`,
      `- Net position: ${inr(receivable - owed)}`,
      `- ${open.length} open loan(s), ${paid} fully paid.`,
      'Individual open loans:',
      ...listed.map((l, i) => describeLoan(l, i + 1, now)),
    ];
    if (sorted.length > listed.length) {
      lines.push(`- …and ${sorted.length - listed.length} more open loans not listed.`);
    }
    return lines.join('\n');
  }

  private async investmentsSection(userId: string, now: Date): Promise<string> {
    if (!this.investmentsService) return '';
    const all = await this.investmentsService.findAll(userId);
    if (all.length === 0) return 'Investments: No investments recorded.';

    const sorted = [...all].sort(
      (a, b) => new Date(a.maturityDate).getTime() - new Date(b.maturityDate).getTime(),
    );
    const listed = sorted.slice(0, MAX_ITEMS_PER_SECTION);
    const totalInvested = all.reduce((s, i) => s + i.principal, 0);
    const totalMaturity = all.reduce((s, i) => s + i.maturityAmount, 0);

    const lines = [
      'Investments Summary:',
      `- Total Invested: ${inr(totalInvested)}`,
      `- Total Expected Maturity Value: ${inr(totalMaturity)}`,
      'Individual investments:',
      ...listed.map((inv, i) => describeInvestment(inv, i + 1, now)),
    ];
    if (sorted.length > listed.length) {
      lines.push(`- …and ${sorted.length - listed.length} more investments not listed.`);
    }
    return lines.join('\n');
  }

  private async accountsSection(userId: string): Promise<string> {
    const accounts = await this.accountRepo.find({ where: { userId, isDeleted: false } });
    if (accounts.length === 0) return '';
    const lines = accounts.slice(0, MAX_ITEMS_PER_SECTION).map((a) => {
      const last4 = a.accountNumberLast4 && a.accountNumberLast4 !== '0000' ? ` ••${a.accountNumberLast4}` : '';
      const limit = a.type === 'credit_card' && a.creditLimit ? `, credit limit ${inr(a.creditLimit)}` : '';
      return `- ${a.name}${last4} (${a.type}): balance ${inr(a.currentBalance)}${limit}`;
    });
    return ['Accounts (balances as tracked in the app):', ...lines].join('\n');
  }
}
