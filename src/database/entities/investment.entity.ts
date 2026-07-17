import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index, BeforeInsert } from 'typeorm';
import { User } from './user.entity';
import { InvestmentType } from '../enums';
import { randomUUID } from 'crypto';

@Entity('investments')
@Index(['userId'])
export class Investment {
  @PrimaryColumn('varchar')
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = randomUUID();
    }
  }

  @Column()
  userId: string;

  @Column({
    type: 'varchar',
    default: InvestmentType.RD,
  })
  type: InvestmentType;

  @Column()
  name: string;

  @Column('float')
  monthlyAmount: number;

  @Column('float')
  principal: number;

  @Column('float')
  maturityAmount: number;

  @Column('int')
  durationMonths: number;

  @Column({ type: 'timestamp with time zone' })
  startDate: Date;

  @Column({ type: 'timestamp with time zone' })
  maturityDate: Date;

  @Column({ type: 'varchar', nullable: true })
  institution: string | null;

  @Column({ type: 'varchar', nullable: true })
  @Index()
  clientId: string | null;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ type: 'boolean', default: false })
  isDeleted: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.investments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
