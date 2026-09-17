import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ChunkingService } from '../services/chunking.service';
import { EmbeddingService } from '../services/embedding.service';
import { VectorStoreService, ChunkPayload } from '../services/vector-store.service';

export interface IngestJobData {
  docId: string;
  sourceId: string;
  title: string;
  category: string;
  content: string;
  version: number;
}

export const INGESTION_QUEUE = 'rag-ingestion';

/**
 * Ingestion runs async: curated docs are edited infrequently but chunking +
 * embedding a large doc set (or a bulk re-ingest) shouldn't block the API
 * thread or the admin's request.
 */
@Processor(INGESTION_QUEUE)
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    private readonly chunking: ChunkingService,
    private readonly embedding: EmbeddingService,
    private readonly vectorStore: VectorStoreService,
  ) {
    super();
  }

  async process(job: Job<IngestJobData>): Promise<void> {
    const { docId, sourceId, title, category, content, version } = job.data;

    // Re-ingestion: wipe the previous version's chunks first so search never
    // mixes stale and fresh chunks for the same source doc.
    await this.vectorStore.deleteBySourceId(sourceId);

    const chunks = this.chunking.chunk(content);
    if (chunks.length === 0) {
      this.logger.warn(`Doc ${sourceId} produced 0 chunks — skipping`);
      return;
    }

    const vectors = await this.embedding.embedPassages(chunks.map((c) => c.text));

    const payloads: ChunkPayload[] = chunks.map((c) => ({
      docId,
      sourceId,
      title,
      category,
      chunkIndex: c.chunkIndex,
      text: c.text,
      version,
      updatedAt: new Date().toISOString(),
    }));

    await this.vectorStore.upsertChunks(vectors, payloads);
    this.logger.log(`Ingested "${title}" (${sourceId}) — ${chunks.length} chunks, v${version}`);
  }
}
