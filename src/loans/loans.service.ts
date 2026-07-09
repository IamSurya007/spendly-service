import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { Loan } from '../database/entities/loan.entity';
import { CreateLoanDto } from './dto/create-loan.dto';
import { UpdateLoanDto } from './dto/update-loan.dto';
import { LoanType, LoanStatus } from '../database/enums';

@Injectable()
export class LoansService {
  constructor(
    @InjectRepository(Loan)
    private readonly loansRepository: Repository<Loan>,
  ) {}

  async create(userId: string, dto: CreateLoanDto): Promise<Loan> {
    const loan = this.loansRepository.create({
      ...dto,
      userId,
      repaymentDate: dto.repaymentDate ? new Date(dto.repaymentDate) : null,
    });
    return this.loansRepository.save(loan);
  }

  async findAll(userId: string, type?: LoanType, status?: LoanStatus): Promise<Loan[]> {
    const where: any = { userId };
    if (type) {
      where.type = type;
    }
    if (status) {
      where.status = status;
    }
    return this.loansRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(userId: string, id: string): Promise<Loan> {
    const loan = await this.loansRepository.findOne({ where: { id } });
    if (!loan) {
      throw new NotFoundException('Loan not found');
    }
    if (loan.userId !== userId) {
      throw new ForbiddenException("You cannot access another user's loan");
    }
    return loan;
  }

  async update(userId: string, id: string, dto: UpdateLoanDto): Promise<Loan> {
    const loan = await this.findOne(userId, id);

    if (dto.type !== undefined) loan.type = dto.type;
    if (dto.name !== undefined) loan.name = dto.name;
    if (dto.principal !== undefined) loan.principal = dto.principal;
    if (dto.total !== undefined) loan.total = dto.total;
    if (dto.repaymentDate !== undefined) {
      loan.repaymentDate = dto.repaymentDate ? new Date(dto.repaymentDate) : null;
    }
    if (dto.status !== undefined) loan.status = dto.status;
    if (dto.notes !== undefined) loan.notes = dto.notes;

    return this.loansRepository.save(loan);
  }

  async remove(userId: string, id: string): Promise<void> {
    const loan = await this.findOne(userId, id);
    await this.loansRepository.remove(loan);
  }

  async getSummary(userId: string) {
    const activeLoans = await this.loansRepository.find({
      where: {
        userId,
        status: Not(LoanStatus.PAID),
      },
    });

    let totalOwed = 0;
    let totalToReceive = 0;
    const upcomingRepayments: any[] = [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const loan of activeLoans) {
      if (loan.type === LoanType.TAKEN) {
        totalOwed += loan.total;
      } else if (loan.type === LoanType.GIVEN) {
        totalToReceive += loan.total;
      }

      if (loan.repaymentDate) {
        const repayment = new Date(loan.repaymentDate);
        repayment.setHours(0, 0, 0, 0);
        const diffTime = repayment.getTime() - today.getTime();
        const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        upcomingRepayments.push({
          id: loan.id,
          name: loan.name,
          total: loan.total,
          repaymentDate: loan.repaymentDate.toISOString().substring(0, 10),
          daysRemaining,
          type: loan.type,
        });
      }
    }

    // Sort upcoming repayments by date ascending (closest repayment date first)
    upcomingRepayments.sort((a, b) => new Date(a.repaymentDate).getTime() - new Date(b.repaymentDate).getTime());

    return {
      totalOwed,
      totalToReceive,
      netPosition: totalToReceive - totalOwed,
      upcomingRepayments: upcomingRepayments.slice(0, 5), // return top 5
    };
  }
}
