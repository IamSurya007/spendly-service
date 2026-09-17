import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import { randomUUID } from 'crypto';

export interface ChunkPayload {
  docId: string;
  sourceId: string;
  title: string;
  category: string;
  chunkIndex: number;
  text: string;
  version: number;
  updatedAt: string;
}

export interface SearchHit {
  score: number;
  payload: ChunkPayload;
}

const COLLECTION = 'spendly_finance_docs';
const VECTOR_DIM = 384; // matches bge-small-en-v1.5 (quantized ONNX, run via the lightweight embedding-service)

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private readonly logger = new Logger(VectorStoreService.name);
  private client: QdrantClient;

  constructor(private readonly config: ConfigService) {
    this.client = new QdrantClient({
      url: this.config.get<string>('QDRANT_URL', 'http://qdrant:6333'),
    });
  }

  async onModuleInit() {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some((c) => c.name === COLLECTION);

      if (!exists) {
        await this.client.createCollection(COLLECTION, {
          vectors: { size: VECTOR_DIM, distance: 'Cosine' },
        });
        // Index category/sourceId for metadata filtering (e.g. re-ingestion, category scoping)
        await this.client.createPayloadIndex(COLLECTION, { field_name: 'sourceId', field_schema: 'keyword' });
        await this.client.createPayloadIndex(COLLECTION, { field_name: 'category', field_schema: 'keyword' });
        this.logger.log(`Created Qdrant collection "${COLLECTION}"`);
      }
    } catch (err: any) {
      this.logger.warn(
        `Could not connect to Qdrant at ${this.config.get('QDRANT_URL')}: ${err.message}. RAG endpoints will require Qdrant & RAG infra to be running.`,
      );
    }
  }

  async upsertChunks(vectors: number[][], payloads: ChunkPayload[]) {
    const points = vectors.map((vector, i) => ({
      id: randomUUID(),
      vector,
      payload: payloads[i] as unknown as Record<string, unknown>,
    }));
    await this.client.upsert(COLLECTION, { wait: true, points });
  }

  /** Removes all existing chunks for a sourceId before re-ingesting a new version — avoids stale chunk drift. */
  async deleteBySourceId(sourceId: string) {
    await this.client.delete(COLLECTION, {
      wait: true,
      filter: { must: [{ key: 'sourceId', match: { value: sourceId } }] },
    });
  }

  async search(queryVector: number[], topK: number, categoryFilter?: string[]): Promise<SearchHit[]> {
    const filter = categoryFilter?.length
      ? { must: [{ key: 'category', match: { any: categoryFilter } }] }
      : undefined;

    const results = await this.client.search(COLLECTION, {
      vector: queryVector,
      limit: topK,
      filter,
      with_payload: true,
    });

    return results.map((r) => ({ score: r.score, payload: r.payload as unknown as ChunkPayload }));
  }
}
