import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface EmbedResponse {
  embeddings: number[][];
  dim: number;
  model: string;
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    // Same docker network as the embedding-service container — internal DNS name, not localhost
    this.baseUrl = this.config.get<string>('EMBEDDING_SERVICE_URL', 'http://embedding-service:8090');
  }

  async embedPassages(texts: string[]): Promise<number[][]> {
    return this.call('/embed/passage', texts);
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.call('/embed/query', [text]);
    return vector;
  }

  private async call(path: string, texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
    });

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`Embedding service ${path} failed: ${res.status} ${body}`);
      throw new Error(`Embedding service error: ${res.status}`);
    }

    const data = (await res.json()) as EmbedResponse;
    return data.embeddings;
  }
}
