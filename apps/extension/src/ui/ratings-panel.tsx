import { useState } from "react";
import type { DetectedTitle, RatingCandidate } from "@milujufilmy/contracts";
import { browser } from "wxt/browser";
import { bestCandidate } from "../matching.js";
import type { TabState } from "../tab-state.js";

export function RatingsPanel({ state, onHide, onRefresh }: { state: TabState; onHide?: () => void; onRefresh: () => void }) {
  const primary = state.titles.find((title) => title.pageRole === "primary");
  const related = state.titles.filter((title) => title !== primary);
  return <main>
    <header><div><h1>MilujuFilmy</h1><p>IMDb a ČSFD na jedné kartě</p></div>{onHide && <button className="hide" aria-label="Skrýt panel MilujuFilmy" onClick={onHide}>×</button>}</header>
    {state.error && <p role="alert" className="error">{state.error} <button onClick={onRefresh}>Zkusit znovu</button></p>}
    {!state.titles.length && <p role="status">{state.loading ? "Rozpoznávám titul…" : "Na této stránce zatím nebyl rozpoznán žádný titul."}</p>}
    {primary && <TitleCard key={primary.requestId} title={primary} state={state} primary onRefresh={onRefresh} />}
    {related.length > 0 && <div className="related"><h2 className="related-heading">Další nalezené filmy na stránce <span>({related.length})</span></h2>{related.map((title) => <TitleCard key={title.requestId} title={title} state={state} onRefresh={onRefresh} />)}</div>}
    <footer>IMDb data: osobní nekomerční použití. Hodnocení jsou odkazy na původní zdroje.</footer>
  </main>;
}

function TitleCard({ title, state, primary, onRefresh }: { title: DetectedTitle; state: TabState; primary?: boolean; onRefresh: () => void }) {
  const [notice, setNotice] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const result = state.results.find((item) => item.requestId === title.requestId);
  const candidates = result?.candidates ?? [];
  const bestYear = title.year ?? candidates[0]?.year;
  const save = async (selected?: RatingCandidate) => {
    setSaving(true); setNotice("");
    try {
      const response = await browser.runtime.sendMessage({ type: selected ? "override" : "csfd-url", detected: title, selected, url }) as { error?: string };
      if (response?.error) throw new Error(response.error);
      setNotice("Shoda byla uložena."); onRefresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Uložení se nezdařilo."); }
    finally { setSaving(false); }
  };
  return <section className={primary ? "title-card primary" : "title-card"} aria-label={primary ? "Hlavní titul" : title.title}>
    {primary && <div className="eyebrow">Právě otevřený titul</div>}
    <h2>{title.title}</h2><small>{[bestYear, title.kind === "series" ? "Seriál" : title.kind === "episode" ? `Epizoda S${title.season}E${title.episode}` : "Film"].filter(Boolean).join(" · ")}</small>
    {(["imdb", "csfd"] as const).map((source) => {
      const match = bestCandidate(title.originalTitle ?? title.title, title.year, candidates.filter((candidate) => candidate.source === source));
      const label = source === "imdb" ? "IMDb" : "ČSFD";
      if (!match) return <p className="missing" key={source}>{label}: {state.loading && !result ? "načítám…" : state.error || result?.warnings?.length ? "nedostupné" : "nenalezeno"}</p>;
      const rating = match.candidate.rating;
      return <div className="rating" key={source}>
        <a href={match.candidate.sourceUrl} target="_blank" rel="noreferrer">{label}</a>
        <strong>{rating ? `${rating.value.toLocaleString("cs-CZ")}${rating.scale === 100 ? " %" : "/10"}` : "bez hodnocení"}</strong>
        {rating?.votes !== undefined && <small>{rating.votes.toLocaleString("cs-CZ")} hlasů</small>}
        {rating && <small>Aktualizováno {new Date(rating.fetchedAt).toLocaleString("cs-CZ")}</small>}
        {match.uncertain && <small className="warning">Možná chybná shoda</small>}
      </div>;
    })}
    {result?.warnings?.map((warning) => <p className="warning" key={warning}>{warning}</p>)}
    <details><summary>Změnit shodu</summary>
      {candidates.map((candidate) => <button disabled={saving} className="candidate" key={`${candidate.source}-${candidate.sourceId}`} onClick={() => void save(candidate)}>{candidate.source.toUpperCase()}: {candidate.canonicalTitle} {candidate.year ?? ""}</button>)}
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}><label>Odkaz na ČSFD<input aria-label={`ČSFD odkaz pro ${title.title}`} type="url" placeholder="https://www.csfd.cz/film/…" required value={url} onChange={(event) => setUrl(event.target.value)} /></label><button disabled={saving}>{saving ? "Ukládám…" : "Použít odkaz"}</button></form>
      {notice && <p role="status">{notice}</p>}
    </details>
  </section>;
}
