import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Investment } from '../database/entities/investment.entity';
import { CreateInvestmentDto } from './dto/create-investment.dto';
import { UpdateInvestmentDto } from './dto/update-investment.dto';

@Injectable()
export class InvestmentsService {
  constructor(
    @InjectRepository(Investment)
    private readonly investmentsRepository: Repository<Investment>,
  ) {}

  private calculateRDMaturity(
    monthlyAmount: number,
    ratePercent: number,
    months: number,
  ): number {
    const r = ratePercent / 400; // quarterly rate
    const n = months / 3;         // number of quarters
    const maturity = monthlyAmount * (((1 + r) ** n - 1) / r) * (1 + r);
    return Math.round(maturity * 100) / 100;
  }

  async create(userId: string, dto: CreateInvestmentDto): Promise<Investment> {
    let maturityAmount = dto.maturityAmount;
    if (maturityAmount === undefined || maturityAmount === null) {
      maturityAmount = this.calculateRDMaturity(
        dto.monthlyAmount,
        dto.interestRate ?? 6.5,
        dto.durationMonths,
      );
    }

    const investment = this.investmentsRepository.create({
      ...dto,
      userId,
      maturityAmount,
      startDate: new Date(dto.startDate),
      maturityDate: new Date(dto.maturityDate),
    });

    return this.investmentsRepository.save(investment);
  }

  async findAll(userId: string): Promise<Investment[]> {
    return this.investmentsRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(userId: string, id: string): Promise<Investment> {
    const investment = await this.investmentsRepository.findOne({ where: { id } });
    if (!investment) {
      throw new NotFoundException('Investment not found');
    }
    if (investment.userId !== userId) {
      throw new ForbiddenException("You cannot access another user's investment");
    }
    return investment;
  }

  async update(userId: string, id: string, dto: UpdateInvestmentDto): Promise<Investment> {
    const investment = await this.findOne(userId, id);

    if (dto.type !== undefined) investment.type = dto.type;
    if (dto.name !== undefined) investment.name = dto.name;
    if (dto.monthlyAmount !== undefined) investment.monthlyAmount = dto.monthlyAmount;
    if (dto.principal !== undefined) investment.principal = dto.principal;
    if (dto.durationMonths !== undefined) investment.durationMonths = dto.durationMonths;
    if (dto.startDate !== undefined) investment.startDate = new Date(dto.startDate);
    if (dto.maturityDate !== undefined) investment.maturityDate = new Date(dto.maturityDate);
    if (dto.institution !== undefined) investment.institution = dto.institution;

    // Recalculate maturity amount if inputs changed and maturityAmount is not override in update request
    const inputsChangedForCalculation =
      dto.monthlyAmount !== undefined || dto.durationMonths !== undefined || dto.interestRate !== undefined;

    if (dto.maturityAmount !== undefined) {
      investment.maturityAmount = dto.maturityAmount;
    } else if (inputsChangedForCalculation) {
      const monthlyAmount = dto.monthlyAmount ?? investment.monthlyAmount;
      const durationMonths = dto.durationMonths ?? investment.durationMonths;
      const interestRate = dto.interestRate ?? 6.5;
      investment.maturityAmount = this.calculateRDMaturity(monthlyAmount, interestRate, durationMonths);
    }

    return this.investmentsRepository.save(investment);
  }

  async remove(userId: string, id: string): Promise<void> {
    const investment = await this.findOne(userId, id);
    await this.investmentsRepository.remove(investment);
  }

  async getSummary(userId: string) {
    const investments = await this.investmentsRepository.find({
      where: { userId },
    });

    const totalInvested = investments.reduce((sum, inv) => sum + inv.principal, 0);
    const totalMaturityValue = investments.reduce((sum, inv) => sum + inv.maturityAmount, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcomingMaturities = investments
      .filter(inv => new Date(inv.maturityDate).getTime() >= today.getTime())
      .map(inv => {
        const maturityDate = new Date(inv.maturityDate);
        maturityDate.setHours(0, 0, 0, 0);
        const diffTime = maturityDate.getTime() - today.getTime();
        const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        return {
          id: inv.id,
          name: inv.name,
          maturityAmount: inv.maturityAmount,
          maturityDate: inv.maturityDate.toISOString().substring(0, 10),
          daysRemaining,
          type: inv.type,
        };
      });

    // Sort upcoming maturities by date ascending
    upcomingMaturities.sort((a, b) => new Date(a.maturityDate).getTime() - new Date(b.maturityDate).getTime());

    return {
      totalInvested,
      totalMaturityValue,
      upcomingMaturities: upcomingMaturities.slice(0, 5), // top 5
    };
  }
}
