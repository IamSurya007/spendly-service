import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index, BeforeInsert } from 'typeorm';
import { User } from './user.entity';
import { randomUUID } from 'crypto';

/**
 * A user's custom category/subcategory, or the user's override (rename,
 * recolour, hide, reorder) of a system category. `clientId` is the category
 * id the apps use: a UUID for custom categories, the system slug (e.g.
 * `food`) for overrides. System categories themselves are not stored; they
 * come from src/categories/taxonomy.generated.ts.
 */
@Entity('categories')
@Index(['userId'])
export class Category {
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
  name: string;

  /** Phosphor icon key, e.g. `fork-knife`. */
  @Column({ type: 'varchar', default: 'tag' })
  icon: string;

  /** `#RRGGBB`. */
  @Column({ type: 'varchar', default: '#9CA3AF' })
  color: string;

  /** expense | income | transfer */
  @Column({ type: 'varchar', default: 'expense' })
  kind: string;

  @Column({ type: 'varchar', nullable: true })
  parentId: string | null;

  @Column({ type: 'boolean', default: false })
  isSystem: boolean;

  @Column({ type: 'boolean', default: false })
  isHidden: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

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

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
