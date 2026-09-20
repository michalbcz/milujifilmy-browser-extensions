import { afterEach, describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalLookup, openDatabase } from "../src/sources.js";
import type { DetectedTitle, RatingCandidate } from "@milujufilmy/contracts";

const dirs: string[] = [];
const lookups: LocalLookup[] = [];
afterEach(async () => { for (const lookup of lookups.splice(0)) await lookup.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.unstubAllGlobals(); vi.useRealTimers(); });
const title: DetectedTitle = { requestId: "1", provider: "ivysilani", title: "Strážce zákona", year: 2008, kind: "movie", locale: "cs-CZ" };
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "mf-import-")); dirs.push(dir);
  const path = join(dir, "test.sqlite");
  const lookup = new LocalLookup(path); lookups.push(lookup);
  return { lookup, path };
}
function datasets(failAliases = false) {
  const requested: string[] = [];
  vi.stubGlobal("fetch", async (input: string) => {
    const file = String(input).split("/").at(-1)!; requested.push(file);
    if (file === "title.akas.tsv.gz" && failAliases) return new Response("unavailable", { status: 503 });
    const data: Record<string, string> = {
      "title.basics.tsv.gz": "tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres\ntt0920470\tmovie\tThe Last Deadly Mission\tMR 73\t0\t2008\t\\N\t125\tCrime\ntt0067333\tmovie\tLawman\tLawman\t0\t1971\t\\N\t99\tWestern\n",
      "title.episode.tsv.gz": "tconst\tparentTconst\tseasonNumber\tepisodeNumber\n",
      "title.ratings.tsv.gz": "tconst\taverageRating\tnumVotes\ntt0920470\t6.6\t6900\ntt0067333\t7.0\t1000\n",
      "title.akas.tsv.gz": "titleId\tordering\ttitle\tregion\tlanguage\ttypes\tattributes\tisOriginalTitle\ntt0920470\t1\tStrážce zákona\tCZ\t\\N\t\\N\t\\N\t0\ntt0067333\t1\tStrážce zákona\tCZ\t\\N\t\\N\t\\N\t0\ntt0920470\t2\tNepotřebný japonský název\tJP\tja\t\\N\t\\N\t0\ntt0920470\t3\tStrážce zákona\tCZ\tcs\t\\N\t\\N\t0\n",
    };
    if (!data[file]) throw new Error(`Unexpected dataset ${file}`);
    return new Response(gzipSync(data[file]));
  });
  return requested;
}

describe("IMDb alias import", () => {
  it("resolves a Czech AKA locally with the right year and prefers a supplied original title", async () => {
    const { lookup } = setup(); const requests = datasets();
    await lookup.syncImdb();
    expect(requests).toContain("title.akas.tsv.gz");
    expect((await lookup.lookup(title)).map(x => x.sourceId)).toEqual(["tt0920470"]);
    expect((await lookup.lookup({ ...title, year: 1971 })).map(x => x.sourceId)).toEqual(["tt0067333"]);
    expect((await lookup.lookup({ ...title, originalTitle: "MR 73" }))[0]?.sourceId).toBe("tt0920470");
    expect(await lookup.lookup({ ...title, title: "Nepotřebný japonský název" })).toEqual([]);
  });
  it("preserves prior datasets, cache and corrections when alias download fails", async () => {
    const { lookup, path } = setup(); datasets(); await lookup.syncImdb();
    const override: RatingCandidate = { source: "imdb", sourceId: "tt0067333", sourceUrl: "https://www.imdb.com/title/tt0067333/", canonicalTitle: "Lawman", kind: "movie", year: 1971, evidence: ["manual"] };
    await lookup.saveOverride({ ...title, providerContentId: "corrected" }, override);
    const db = openDatabase(path); db.prepare("UPDATE metadata SET value='2000-01-01T00:00:00Z' WHERE key='imdb_snapshot_date'").run(); db.close();
    datasets(true);
    await expect(lookup.syncImdb()).rejects.toThrow("503");
    expect((await lookup.lookup(title))[0]?.sourceId).toBe("tt0920470");
    expect((await lookup.lookup({ ...title, providerContentId: "corrected" }))[0]?.sourceId).toBe("tt0067333");
  });
});
