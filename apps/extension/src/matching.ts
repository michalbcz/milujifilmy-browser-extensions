import type { RatingCandidate } from "@milujufilmy/contracts";

export interface RankedCandidate {
  candidate: RatingCandidate;
  confidence: number;
  uncertain: boolean;
}

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function bestCandidate(title: string, year: number | undefined, candidates: RatingCandidate[]): RankedCandidate | undefined {
  return candidates.map((candidate) => {
    const titleWords = new Set(normalized(title).split(" "));
    const titleScore = Math.max(...[candidate.canonicalTitle, candidate.originalTitle, ...(candidate.aliases ?? [])].filter((value): value is string => Boolean(value)).map((candidateTitle) => {
      const candidateWords = new Set(normalized(candidateTitle).split(" "));
      const shared = [...titleWords].filter((word) => candidateWords.has(word)).length;
      return normalized(title) === normalized(candidateTitle)
        ? 0.85
        : 0.65 * shared / Math.max(titleWords.size, candidateWords.size, 1);
    }));
    const yearScore = year === undefined || candidate.year === undefined ? 0 : year === candidate.year ? 0.15 : -0.25;
    const confidence = candidate.evidence.includes("manual") ? 1 : Math.max(0, Math.min(1, Number((titleScore + yearScore).toFixed(2))));
    return { candidate, confidence, uncertain: confidence < 0.8 };
  }).sort((a, b) => b.confidence - a.confidence)[0];
}
