# MilujuFilmy

Osobní, nekomerční rozšíření pro Chrome a Edge. Na Netflixu, HBO Max, Disney+, Prime Video, Oneplay, prima+, iVysílání a Stream.cz rozpozná otevřený titul a viditelné karty. Panel hodnocení se otevře automaticky přímo na stránce; hlavní titul je zvýrazněný a ostatní jsou pod „Další nalezené filmy na stránce“.

Panel zavřete křížkem. Vrátíte ho tlačítkem „MilujuFilmy · hodnocení“ nebo ikonou rozšíření. Skrytí se pamatuje pro danou kartu během aktuální relace Chrome, včetně změny stránky. Při změně URL (i bez reloadu v SPA), zpět/vpřed a změně metadat se údaje obnoví. Ve fullscreenu se panel i odznaky skryjí. Nativní panel Chrome má stejné zobrazení a sleduje aktivní kartu; automatické otevírání zajišťuje panel ve Shadow DOM, protože nativní `sidePanel.open()` vyžaduje uživatelské gesto.

## Vývoj

### Požadavky

- Node.js 22 nebo novější, Corepack a `pnpm`;
- Docker Desktop pro lokální API;
- Chrome nebo Edge v režimu vývojáře.

### První spuštění

```sh
just setup
just backend-up
```

Docker Compose spustí i privátní SearXNG; jeho port není publikovaný na hostiteli. První start vytvoří `data/pairing-token.txt`. Otevřete rozšíření v prohlížeči a v jeho **Možnostech** token vložte. Poté spusťte vývojové rozšíření:

```sh
just dev
```

`just dev` ponechte běžet. V Chrome přejděte na `chrome://extensions`, v Edge na `edge://extensions`, zapněte **Režim pro vývojáře** a zvolte **Načíst rozbalené**. Vyberte `apps/extension/.output/chrome-mv3-dev`.

Při úpravě content scriptu, panelu nebo manifestu WXT výstup aktualizuje; na stránce rozšíření pak použijte tlačítko pro opětovné načtení rozšíření. Backend zastavíte příkazem:

```sh
just backend-down
```

## Testování

Před odesláním změny spusťte kompletní kontrolu:

```sh
just test
just typecheck
just test-e2e
```

`just test` spustí validační kontrakty, backend i extension testy. `just typecheck` kontroluje TypeScript ve všech workspacích. Po změně adaptérů proveďte také ruční UAT na přihlášeném účtu: u každé služby alespoň 3 filmy, 3 seriály a 2 epizody, včetně navigace SPA a fullscreenu.

Pro E2E nejprve nainstalujte testovací prohlížeč: `pnpm --filter @milujufilmy/extension exec playwright install chromium`. Test používá dočasný profil a fixture API: ověřuje automatické otevření, skrytí, zachování skrytí po reloadu, SPA navigaci během pomalé odpovědi, fullscreen a nedostupný backend. Živý test čtyř konkrétních titulů iVysílání spustíte proti běžícímu a napárovanému backendu:

```sh
MILUJU_FILMY_LIVE_E2E=1 pnpm --filter @milujufilmy/extension test:e2e
```

Živý test používá veřejné stránky Strážce zákona (2008), Helsinského syndromu, Strachu nad městem a Tohle bude bolet, načte lokální token bez vypsání a ukládá screenshoty do `apps/extension/test-results/`. Kontroluje také identitu ČSFD odkazu, aby stejně pojmenovaný film neprošel jen díky podobnému ratingu. Očekávané ratingy jsou kontrolní snapshot; při jejich skutečné změně ověřte zdroj před úpravou testu.

## Build a distribuce

Produkční Chrome/Edge artefakt připravíte takto:

```sh
just build
just package
shasum -a 256 apps/extension/.output/milujufilmyextension-*-chrome.zip
```

`just build` vytvoří rozbalené MV3 rozšíření v `apps/extension/.output/chrome-mv3`; `just package` navíc vytvoří verzovaný ZIP v `apps/extension/.output`.

Rozšíření v1 není určeno pro Chrome Web Store ani Edge Add-ons. ZIP je distribuční artefakt pro důvěryhodné uživatele: předají se jim ZIP a SHA-256, ZIP rozbalí do vlastní složky a přes **Načíst rozbalené** načtou adresář `chrome-mv3`. Chrome ani Edge obvykle nedovolí instalovat lokální MV3 ZIP prostým otevřením souboru.

Při propagaci vždy přiložte minimálně verzi, SHA-256, odkaz na tento návod a upozornění, že jde o osobní nekomerční nástroj vyžadující lokální Docker backend a párovací token. Token ani soubor `data/` nikdy nedistribuujte.

## Jak to funguje

- Content script pracuje výhradně s URL a veřejně vykresleným DOM; nečte cookies ani interní API videoték.
- Nejdřív zpracuje aktuální titul, následně další viditelné karty (celkem nejvýše 25 titulů). Hlavní titul může spustit online dohledání; související karty používají jen lokální IMDb a dříve uložené výsledky. Otevření karty jako hlavního titulu spustí plné dohledání ihned, i když její lokální lookup nic nenašel. `MutationObserver`, `IntersectionObserver` a sledování URL zajišťují SPA navigaci a virtualizované seznamy. Opožděná odpověď pro starou stránku nesmí přepsat nový titul. Panel rozlišuje načítání, nenalezený titul a nedostupný zdroj.
- Lokální API naslouchá jen na `127.0.0.1:47321`. Lookup, synchronizace i ruční opravy vyžadují bearer token plus hlavičku `x-milujufilmy-client`.
- Backend nejprve použije SQLite: uložené automatické identity, detaily a lokální IMDb včetně alternativních názvů. Chybějící zdroj dohledá přes Wikidata, přímé hledání ČSFD a nakonec SearXNG. Známé IMDb nezabrání dohledání chybějícího ČSFD. IMDb odkaz se přes web hledá jen tehdy, máme-li místní dataset, ze kterého lze načíst data.
- Automatická identita zdroje se ukládá samostatně od ratingu jen při jistotě alespoň 0,80. Detaily ČSFD se obnovují po 24 hodinách; při výpadku se vrací poslední hodnocení s původním časem. Úplný výsledek má cache až 24 hodin, neúplný jednu minutu. SearXNG odpovědi se ukládají 24 hodin, prázdné nebo částečné jednu minutu. Souběžné stejné lookupy i webové dotazy se slučují.
- IMDb se importuje z oficiálních non-commercial datasetů `title.basics`, `title.episode`, `title.ratings` a `title.akas`. U aliasů ukládáme regiony CZ/SK/US/GB nebo jazyky cs/sk/en; gzip se stáhne celý. Známý originální název, rok, typ a číslo epizody mají přednost před nejednoznačným překladem. Web IMDb se nescrapuje. Wikidata mohou dodat IMDb ID i bez odkazu na ČSFD.
- Pro ČSFD se přednostně čte veřejné HTML standardním HTTP požadavkem. Chromium v izolovaném profilu slouží pouze pro stránky vyžadující vykreslení. CAPTCHA nebo zákaz přístupu není důvodem k automatickému obcházení; uživatelův profil a cookies se nepřenášejí.
- Webové vyhledávání používá rozhraní `SearchProvider` s adaptérem SearXNG. Přímý DDG scraper je odstraněn. Soukromý SearXNG v Dockeru používá pouze enginy Brave a Bing, JSON API a vypnuté autocomplete. Jde o webové enginy SearXNG, nikoli placené Brave API. I tyto enginy mohou být nedostupné nebo blokované; neúplná odpověď se rozlišuje od platného prázdného výsledku.
- Požadavky na jednotlivé zdroje jsou sériové s rozestupem alespoň sekundy. Exponenciální čekání po chybách (30 sekund až hodina), delší čekání po blokaci a serverové `Retry-After` se ukládají do SQLite a přežijí restart i IMDb import. ČSFD/SearXNG 202/403/429 vyvolá přestávku alespoň pět minut. Stav je v `GET /v1/health`; nevyřešené zdroje dostanou v panelu upozornění.
- Ruční oprava se ukládá po zdrojích podle poskytovatele a content ID (nebo normalizované identity), bez expirace. V „Změnit shodu“ lze vybrat kandidáta nebo vložit HTTPS odkaz na ČSFD. Backend URL ověří, sám načte detail a uloží shodu přes `POST /v1/matches/csfd`; samotná hodnota ratingu se natvrdo nenastavuje.

Pro ruční aktualizaci IMDb zavolejte autorizovaný endpoint `POST /v1/imdb/sync`; jde o velký download a spouští se nanejvýš jednou denně provozním postupem. Import se připraví v dočasné SQLite databázi. Po dokončení se v jedné transakci nahradí pouze tabulky IMDb; cache, identity, ruční opravy a stav zdrojů zůstanou zachované. Neúspěch ponechá předchozí dataset použitelný. Aliasový dataset se načte při příští ručně spuštěné synchronizaci, nikoli automaticky při startu; zůstává limit jedné aktualizace za 24 hodin.

## Nastavení vyhledávání

Výchozí Docker konfigurace nevyžaduje účet ani API klíč. `just backend-up` spustí obě služby. SearXNG naslouchá jen v síti Compose, hlavní API zůstává na `127.0.0.1:47321`. Klíč instance SearXNG se automaticky vytvoří v privátním Docker svazku, nevypisuje se ani se neukládá do repozitáře. `just backend-down` data nemaže.

```sh
# Stav služeb a zdrojů; health neobsahuje párovací token.
docker compose ps
curl --fail http://127.0.0.1:47321/v1/health

# Vypnout pouze webový fallback; ČSFD a Wikidata zůstávají dostupné.
MILUJU_FILMY_SEARCH_PROVIDER=none just backend-up

# Vypnout všechno automatické online dohledávání.
MILUJU_FILMY_ONLINE_SEARCH=0 just backend-up
```

Proměnné lze uložit i do lokálního `.env`. Pro obnovení výchozího chování použijte `MILUJU_FILMY_SEARCH_PROVIDER=searxng` a `MILUJU_FILMY_ONLINE_SEARCH=1`. Explicitní ruční vložení ČSFD URL zůstává samostatně povolenou operací.

Při spuštění API přímo přes Node nastavte `MILUJU_FILMY_SEARXNG_URL` na vlastní dostupnou instanci (výchozí `http://127.0.0.1:47322`), nebo `MILUJU_FILMY_SEARCH_PROVIDER=none`. Docker verze používá interní `http://searxng:8080`.

Seznam enginů je v [`infra/searxng/settings.yml`](infra/searxng/settings.yml). Změnu použijete příkazem `docker compose restart searxng`. Pinned image v Compose aktualizujte záměrně a ověřte JSON endpoint; [oficiální dokumentace kontejneru](https://docs.searxng.org/admin/installation-docker.html) a [Search API](https://docs.searxng.org/dev/search_api.html).

Tato změna připravuje nový backend; samotný build neaktualizuje již spuštěný kontejner. Při provozu z více worktree nespouštějte dvě API na stejném portu a nepřipojujte současně dva backendy ke stejné databázi. Použijte vybraný checkout se svým existujícím `data/`; nový worktree vlastní původní databázi ani párování automaticky nepřebírá.

## Omezení v1

Adaptéry mají obecné veřejné DOM selektory a izolují chybu konkrétní služby. HTML konkrétní videotéky se proto může změnit; před běžným používáním je nutné udělat plánované ruční UAT na přihlášených účtech (3 filmy, 3 seriály a 2 epizody na službu). Firefox/Safari, store publikace a další lokální ratingové zdroje nejsou součástí této verze.

IMDb data jsou určena pouze pro osobní nekomerční použití; zdrojové odkazy v panelu vedou na IMDb a ČSFD. Respektujte prosím [IMDb usage rules](https://help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/G5JTRESSHJBBHTGX) a [ČSFD robots.txt](https://www.csfd.cz/robots.txt).

Unit testy kryjí validační kontrakty, českou diakritiku a rok ve skórování, epizodní značení, registry všech osmi providerů, autorizaci batch lookupu a perzistenci ruční opravy po znovuotevření SQLite.
