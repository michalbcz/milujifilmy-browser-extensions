import cors from "@fastify/cors";
import Fastify from "fastify";
import { detectedTitleSchema, lookupBatchRequestSchema, ratingCandidateSchema, type DetectedTitle, type RatingCandidate } from "@milujufilmy/contracts";

export interface AppOptions {
  token: string;
  lookup: (title: DetectedTitle) => Promise<RatingCandidate[]>;
  snapshotDate?: string | (() => string | undefined);
  sourceStatus?: () => Record<string, unknown>;
  sourceWarnings?: () => string[];
  sync?: () => Promise<void>;
  saveOverride?: (detected: DetectedTitle, selected: RatingCandidate) => Promise<void>;
  saveCsfdUrl?: (detected: DetectedTitle, url: string) => Promise<RatingCandidate>;
}

export function createApp(options: AppOptions) {
  const app = Fastify({ logger: true });
  void app.register(cors, {
    origin: (origin, callback) => callback(null, !origin || /^(chrome-extension|extension):\/\//.test(origin)),
    allowedHeaders: ["authorization", "content-type", "x-milujufilmy-client"],
  });

  app.get("/v1/health", async () => ({
    ok: true,
    version: "0.1.0",
    snapshotDate: typeof options.snapshotDate === "function" ? options.snapshotDate() ?? null : options.snapshotDate ?? null,
    sources: options.sourceStatus?.() ?? {},
  }));

  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/v1/health") return;
    const expected = `Bearer ${options.token}`;
    if (request.headers.authorization !== expected || request.headers["x-milujufilmy-client"] === undefined) {
      return reply.code(401).send({ error: "Pairing token required" });
    }
  });

  app.post("/v1/lookup/batch", async (request, reply) => {
    const parsed = lookupBatchRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const results = await Promise.all(
      parsed.data.items.map(async (title) => {
        const candidates = await options.lookup(title);
        return { requestId: title.requestId, candidates, warnings: candidates.length < 2 ? options.sourceWarnings?.() ?? [] : [] };
      }),
    );
    return { results };
  });

  app.post("/v1/imdb/sync", async (_request, reply) => {
    if (!options.sync) return reply.code(501).send({ error: "IMDb sync is not configured" });
    await options.sync();
    return { ok: true };
  });

  app.post("/v1/matches/override", async (request, reply) => {
    if (!options.saveOverride) return reply.code(501).send({ error: "Manual corrections are not configured" });
    const body = request.body as { detected?: unknown; selected?: unknown };
    const detected = detectedTitleSchema.safeParse(body?.detected);
    const selected = ratingCandidateSchema.safeParse(body?.selected);
    if (!detected.success || !selected.success) return reply.code(400).send({ error: "Invalid manual correction" });
    await options.saveOverride(detected.data, selected.data);
    return { ok: true };
  });
  app.post("/v1/matches/csfd", async (request, reply) => {
    const body = request.body as { detected?: unknown; url?: unknown };
    const detected = detectedTitleSchema.safeParse(body?.detected);
    if (!detected.success || typeof body?.url !== "string") return reply.code(400).send({ error: "Invalid source URL or title" });
    if (!options.saveCsfdUrl) return reply.code(501).send({ error: "Not configured" });
    try { return { candidate: await options.saveCsfdUrl(detected.data, body.url) }; }
    catch (error) { return reply.code(422).send({ error: error instanceof Error ? error.message : "ČSFD není dostupné." }); }
  });
  return app;
}
