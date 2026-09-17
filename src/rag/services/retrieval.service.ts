import { Injectable } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService, SearchHit } from './vector-store.service';

const TOP_K = 8;
// Cosine similarity floor below which a chunk is treated as "not actually relevant"
// rather than forced into the prompt. Tune against real queries during eval.
const RELEVANCE_THRESHOLD = 0.35;
const MAX_CHUNKS_PER_DOC = 2; // avoid one long doc crowding out other sources

@Injectable()
export class RetrievalService {
  constructor(
    private readonly embedding: EmbeddingService,
    private readonly vectorStore: VectorStoreService,
  ) {}

  async retrieve(question: string, categoryFilter?: string[]): Promise<SearchHit[]> {
    const queryVector = await this.embedding.embedQuery(question);
    const hits = await this.vectorStore.search(queryVector, TOP_K, categoryFilter);

    const aboveThreshold = hits.filter((h) => h.score >= RELEVANCE_THRESHOLD);

    // cap per-document representation, keep highest-scoring chunks per doc
    const perDocCount = new Map<string, number>();
    const diversified: SearchHit[] = [];
    for (const hit of aboveThreshold) {
      const count = perDocCount.get(hit.payload.sourceId) ?? 0;
      if (count >= MAX_CHUNKS_PER_DOC) continue;
      perDocCount.set(hit.payload.sourceId, count + 1);
      diversified.push(hit);
    }

    return diversified;
  }
}
