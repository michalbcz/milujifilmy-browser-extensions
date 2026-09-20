import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createApp } from "./app.js";
import { listenHost, searchConfig } from "./server-config.js";
import { LocalLookup } from "./sources.js";

const dataDir = process.env.MILUJU_FILMY_DATA_DIR ?? "data";
const tokenPath = join(dataDir, "pairing-token.txt");

async function pairingToken() {
  await mkdir(dataDir, { recursive: true });
  try {
    return (await readFile(tokenPath, "utf8")).trim();
  } catch {
    const token = randomBytes(32).toString("hex");
    await writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
    console.info(`MilujuFilmy pairing token written to ${tokenPath}`);
    return token;
  }
}

const token = await pairingToken();
const lookup = new LocalLookup(join(dataDir, "milujufilmy.sqlite"), { onlineSearch: process.env.MILUJU_FILMY_ONLINE_SEARCH !== "0", ...searchConfig() });
const app = createApp({ token, lookup: (title) => lookup.lookup(title), sync: () => lookup.syncImdb(), saveOverride: (title, candidate) => lookup.saveOverride(title, candidate), saveCsfdUrl: (title, url) => lookup.saveCsfdUrl(title, url), snapshotDate: () => lookup.snapshotDate(), sourceStatus: () => lookup.sourceStatus(), sourceWarnings: () => lookup.sourceWarnings() });
app.addHook("onClose", () => lookup.close());
process.once("SIGTERM", () => void app.close());
await app.listen({ host: listenHost(), port: 47321 });
