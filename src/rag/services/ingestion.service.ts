import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { IngestDocumentDto } from '../dto/ingest-document.dto';
import { INGESTION_QUEUE, IngestJobData } from '../queue/ingestion.processor';

@Injectable()
export class IngestionService {
  constructor(@InjectQueue(INGESTION_QUEUE) private readonly queue: Queue<IngestJobData>) {}

  async ingest(dto: IngestDocumentDto): Promise<{ jobId: string; docId: string }> {
    // Deterministic docId from sourceId → re-ingesting the same source updates
    // in place rather than creating a duplicate document.
    const docId = createHash('sha256').update(dto.sourceId).digest('hex').slice(0, 16);
    const version = Date.now();

    const job = await this.queue.add('ingest-document', {
      docId,
      sourceId: dto.sourceId,
      title: dto.title,
      category: dto.category,
      content: dto.content,
      version,
    });

    return { jobId: job.id as string, docId };
  }
}
