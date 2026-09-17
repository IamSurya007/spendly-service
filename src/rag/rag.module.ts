import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RagController } from './rag.controller';
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

@Module({
  imports: [
    UsersModule,
    AuthModule,
    ExpensesModule,
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
  controllers: [RagController],
  providers: [
    EmbeddingService,
    ChunkingService,
    VectorStoreService,
    RetrievalService,
    GenerationService,
    IngestionService,
    IngestionProcessor,
  ],
  exports: [RetrievalService, GenerationService],
})
export class RagModule {}
