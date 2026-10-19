import type { RatingCandidate } from "@milujufilmy/contracts";

export interface RankedCandidate {
  candidate: RatingCandidate;
  confidence: number;
  uncertain: boolean;
}

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function bestCandidate(title: string, year: number | undefined, candidates: RatingCandidate[], episode?: { season: number; episode: number }): RankedCandidate | undefined {
  return candidates.map((candidate) => {
    // Episodes carry their own names; the backend matched them by series plus season/episode code.
    if (episode && candidate.kind === "episode" && candidate.season === episode.season && candidate.episode === episode.episode) {
      return { candidate, confidence: 1, uncertain: false };
    }
    const titleWords = new Set(normalized(title).split(" "));
    const titleScore = Math.max(...[candidate.canonicalTitle, candidate.originalTitle, ...(candidate.aliases ?? [])].filter((value): value is string => Boolean(value)).map((candidateTitle) => {
      const candidateWords = new Set(normalized(candidateTitle).split(" "));
      const shared = [...titleWords].filter((word) => candidateWords.has(word)).length;
      return normalized(title) === normalized(candidateTitle)
        ? 0.85
        : 0.65 * shared / Math.max(titleWords.size, candidateWords.size, 1);
    }));
    const yearScore = year === undefined || candidate.year === undefined ? 0 : year === candidate.year ? 0.15 : Math.abs(year - candidate.year) === 1 ? 0 : -0.25;
    const confidence = candidate.evidence.includes("manual") ? 1 : Math.max(0, Math.min(1, Number((titleScore + yearScore).toFixed(2))));
    return { candidate, confidence, uncertain: confidence < 0.8 };
  }).sort((a, b) => b.confidence - a.confidence)[0];
}
