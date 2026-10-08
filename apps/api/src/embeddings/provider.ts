import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
export interface EmbeddingProvider {
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
}
// Deterministic, free development adapter. NOT a production semantic model.
@Injectable()
export class DevelopmentEmbeddingProvider implements EmbeddingProvider {
  readonly model = "development-hash-64";
  readonly version = "1";
  readonly dimensions = 64;
  async embed(text: string) {
    const vector = Array<number>(this.dimensions).fill(0);
    const terms = text
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{M}\p{N}]+/gu) ?? ["empty"];
    for (const term of terms) {
      const hash = createHash("sha256").update(term).digest();
      vector[hash.readUInt16BE(0) % this.dimensions] += hash[2] % 2 ? 1 : -1;
    }
    let norm = Math.sqrt(vector.reduce((n, x) => n + x * x, 0));
    if (!norm) {
      vector[0] = 1;
      norm = 1;
    }
    return vector.map((v) => v / norm);
  }
}
export function chunkText(text: string, size = 900, overlap = 100) {
  if (size <= 0 || overlap < 0 || overlap >= size)
    throw new Error("Invalid chunk bounds.");
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let start = 0; start < chars.length; start += size - overlap) {
    const chunk = chars
      .slice(start, start + size)
      .join("")
      .trim();
    if (chunk) chunks.push(chunk);
    if (start + size >= chars.length) break;
  }
  return chunks;
}
export function vectorLiteral(vector: number[], dimensions: number) {
  if (vector.length !== dimensions || vector.some((v) => !Number.isFinite(v)))
    throw new Error("Invalid embedding vector.");
  return `[${vector.join(",")}]`;
}
