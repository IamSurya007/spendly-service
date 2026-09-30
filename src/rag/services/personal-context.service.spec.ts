import { describeInvestment, describeLoan, installmentsPaid } from './personal-context.service';
import { InvestmentType, LoanStatus, LoanType } from '../../database/enums';

const now = new Date(2026, 8, 30, 12); // 30 Sep 2026, local time

describe('personal context formatting', () => {
  it('describes a loan with every stored detail and days to repayment', () => {
    const line = describeLoan(
      {
        name: 'HDFC Personal Loan',
        type: LoanType.TAKEN,
        principal: 200000,
        total: 236000,
        interestRate: 11.5,
        repaymentDate: new Date(2026, 9, 10, 12),
        status: LoanStatus.ACTIVE,
        notes: 'EMI on 5th',
      } as any,
      1,
      now,
    );
    expect(line).toContain('L1. HDFC Personal Loan (borrowed — you owe)');
    expect(line).toContain('principal ₹2,00,000');
    expect(line).toContain('total to repay ₹2,36,000');
    expect(line).toContain('interest 11.5% p.a.');
    expect(line).toContain('due in 10 days');
    expect(line).toContain('status ACTIVE');
    expect(line).toContain('notes: "EMI on 5th"');
  });

  it('marks overdue loans and loans without a date', () => {
    const overdue = describeLoan(
      { name: 'Ravi', type: LoanType.GIVEN, principal: 5000, total: 5000, interestRate: 0, repaymentDate: new Date(2026, 8, 25, 12), status: LoanStatus.OVERDUE, notes: null } as any,
      2,
      now,
    );
    expect(overdue).toContain('lent — owed to you');
    expect(overdue).toContain('5 days overdue');
    expect(overdue).not.toContain('interest');

    const undated = describeLoan(
      { name: 'Mom', type: LoanType.TAKEN, principal: 1000, total: 1000, interestRate: 0, repaymentDate: null, status: LoanStatus.ACTIVE, notes: null } as any,
      3,
      now,
    );
    expect(undated).toContain('no repayment date set');
  });

  it('counts RD installments paid so far', () => {
    expect(installmentsPaid(new Date(2026, 0, 5), now, 24)).toBe(9); // Jan..Sep
    expect(installmentsPaid(new Date(2026, 8, 30), now, 24)).toBe(1);
    expect(installmentsPaid(new Date(2027, 0, 1), now, 24)).toBe(0);
    expect(installmentsPaid(new Date(2020, 0, 1), now, 12)).toBe(12); // capped at duration
  });

  it('describes a recurring investment with amount invested so far and time to maturity', () => {
    const line = describeInvestment(
      {
        name: 'SBI RD',
        type: InvestmentType.RD,
        institution: 'SBI',
        monthlyAmount: 5000,
        principal: 120000,
        maturityAmount: 128900,
        durationMonths: 24,
        interestRate: 6.8,
        startDate: new Date(2026, 0, 5),
        maturityDate: new Date(2028, 0, 5),
      } as any,
      1,
      now,
    );
    expect(line).toContain('I1. SBI RD (RD, SBI)');
    expect(line).toContain('₹5,000/month for 24 months');
    expect(line).toContain('9 installments so far ≈ ₹45,000 invested');
    expect(line).toContain('rate 6.8% p.a.');
    expect(line).toContain('expected maturity value ₹1,28,900');
    expect(line).toMatch(/matures 2028-01-0\d \(~15 months left\)/);
  });

  it('describes a lump-sum investment and a matured one', () => {
    const line = describeInvestment(
      {
        name: 'HDFC FD', type: InvestmentType.FD, institution: null, monthlyAmount: 0, principal: 100000,
        maturityAmount: 107000, durationMonths: 12, interestRate: 0,
        startDate: new Date(2025, 0, 1), maturityDate: new Date(2026, 0, 1),
      } as any,
      2,
      now,
    );
    expect(line).toContain('invested ₹1,00,000');
    expect(line).toContain('matured on');
  });
});
