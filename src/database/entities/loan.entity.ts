import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index, BeforeInsert } from 'typeorm';
import { User } from './user.entity';
import { LoanType, LoanStatus } from '../enums';
import { randomUUID } from 'crypto';

@Entity('loans')
@Index(['userId', 'type'])
@Index(['userId', 'status'])
export class Loan {
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
  })
  type: LoanType;

  @Column()
  name: string;

  @Column('float')
  principal: number;

  @Column('float')
  total: number;

  @Column({ type: 'timestamp with time zone', nullable: true })
  repaymentDate: Date | null;

  @Column({
    type: 'varchar',
    default: LoanStatus.ACTIVE,
  })
  status: LoanStatus;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ default: false })
  reminderSent: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => User, (user) => user.loans, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
