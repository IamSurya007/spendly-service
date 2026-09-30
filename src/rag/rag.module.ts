import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RagController } from './rag.controller';
import { ChatHistoryController } from './chat-history.controller';
import { ChatHistoryService } from './services/chat-history.service';
import { PersonalContextService } from './services/personal-context.service';
import { ChatConversation } from '../database/entities/chat-conversation.entity';
import { ChatMessage } from '../database/entities/chat-message.entity';
import { Account } from '../database/entities/account.entity';
import { EmbeddingService } from './services/embedding.service';
import { ChunkingService } from './services/chunking.service';
import { VectorStoreService } from './services/vector-store.service';
import { RetrievalService } from './services/retrieval.service';
import { GenerationService } from './services/generation.service';
import { IngestionService } from './services/ingestion.service';
import { IngestionProcessor, INGESTION_QUEUE } from './queue/ingestion.processor';

import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/auth.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { LoansModule } from '../loans/loans.module';
import { InvestmentsModule } from '../investments/investments.module';

@Module({
  imports: [
    UsersModule,
    AuthModule,
    ExpensesModule,
    LoansModule,
    InvestmentsModule,
    TypeOrmModule.forFeature([ChatConversation, ChatMessage, Account]),
    BullModule.registerQueueAsync({
      name: INGESTION_QUEUE,
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'redis'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [RagController, ChatHistoryController],
  providers: [
    EmbeddingService,
    ChunkingService,
    VectorStoreService,
    RetrievalService,
    GenerationService,
    IngestionService,
    IngestionProcessor,
    PersonalContextService,
    ChatHistoryService,
  ],
  exports: [RetrievalService, GenerationService],
})
export class RagModule {}
