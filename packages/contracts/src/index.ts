import { z } from "zod";

export const mediaKindSchema = z.enum(["movie", "series", "episode"]);
export type MediaKind = z.infer<typeof mediaKindSchema>;

export const detectedTitleSchema = z
  .object({
    requestId: z.string().min(1),
    provider: z.string().min(1),
    providerContentId: z.string().min(1).optional(),
    parentContentId: z.string().min(1).optional(),
    title: z.string().min(1),
    originalTitle: z.string().min(1).optional(),
    year: z.number().int().min(1888).max(2100).optional(),
    kind: mediaKindSchema,
    season: z.number().int().positive().optional(),
    episode: z.number().int().positive().optional(),
    episodeTitle: z.string().min(1).optional(),
    locale: z.enum(["cs-CZ", "en"]),
    pageRole: z.enum(["primary", "related"]).optional(),
  })
  .superRefine((value, context) => {
    if (value.kind === "episode" && (!value.season || !value.episode)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Episode requires season and episode" });
    }
  });

export type DetectedTitle = z.infer<typeof detectedTitleSchema>;

export const ratingSchema = z.object({
  value: z.number().nonnegative(),
  scale: z.union([z.literal(10), z.literal(100)]),
  votes: z.number().int().nonnegative().optional(),
  fetchedAt: z.string().datetime(),
});

export const ratingCandidateSchema = z.object({
  source: z.enum(["imdb", "csfd"]),
  sourceId: z.string().min(1),
  sourceUrl: z.string().url(),
  canonicalTitle: z.string().min(1),
  originalTitle: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  year: z.number().int().optional(),
  kind: mediaKindSchema,
  season: z.number().int().positive().optional(),
  episode: z.number().int().positive().optional(),
  rating: ratingSchema.optional(),
  evidence: z.array(z.string()),
});

export type RatingCandidate = z.infer<typeof ratingCandidateSchema>;

export const lookupBatchRequestSchema = z.object({ items: z.array(detectedTitleSchema).min(1).max(25) });
export const lookupBatchResponseSchema = z.object({
  results: z.array(z.object({ requestId: z.string(), candidates: z.array(ratingCandidateSchema), warnings: z.array(z.string()).optional() })),
});
