import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index, Unique, BeforeInsert } from 'typeorm';
import { User } from './user.entity';
import { randomUUID } from 'crypto';

@Entity('budgets')
@Unique(['userId', 'month', 'category'])
@Index(['userId', 'month'])
export class Budget {
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

  @Column()
  month: string; // format: "2026-07"

  @Column()
  category: string;

  @Column('float')
  limit: number;

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

  @ManyToOne(() => User, (user) => user.budgets, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
