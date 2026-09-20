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

První start vytvoří `data/pairing-token.txt`. Otevřete rozšíření v prohlížeči a v jeho **Možnostech** token vložte. Poté spusťte vývojové rozšíření:

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
- Nejdřív zpracuje aktuální titul, následně další viditelné karty (celkem nejvýše 25 titulů). `MutationObserver`, `IntersectionObserver` a sledování URL zajišťují SPA navigaci a virtualizované seznamy. Opožděná odpověď pro starou stránku nesmí přepsat nový titul. Panel rozlišuje načítání, nenalezený titul a nedostupný zdroj.
- Lokální API naslouchá jen na `127.0.0.1:47321`. Lookup, synchronizace i ruční opravy vyžadují bearer token plus hlavičku `x-milujufilmy-client`.
- Backend je persistentní cache plněná na požádání: **SQLite → chybějící titul vyhledat na ČSFD → načíst detail → uložit → vrátit rozšíření**. Český název se hledá přímo na `/hledat`; výsledky se rozlišují podle názvu, roku a typu (film/seriál/epizoda). Z detailu se čte skutečný rok, originální název, rating a počet hlasů. Originální název propojí český titul s lokálními IMDb daty.
- Uložené výsledky přežijí restart backendu i aktualizaci IMDb datasetu. Záznamy jsou společné pro poskytovatele; stejný souběžný dotaz se načítá jednou. Detaily ČSFD jsou navíc uložené podle ID. Po 24 hodinách se při dalším požadavku obnoví rating ze známého detailu; při výpadku zůstane poslední funkční hodnocení s původním časem aktualizace. Nenalezený výsledek se opakuje po minutě, nikoli až po měsíci.
- Pro ČSFD se přednostně čte plné veřejné HTML standardním HTTP požadavkem. Pokud stránka potřebuje vykreslení, backend použije Playwright Chromium v izolovaném profilu. Docker obraz obsahuje prohlížeč i jeho závislosti. Během živé diagnostiky ČSFD vracelo HTTP klientovi data, ale headless prohlížeči BotStopper „Přístup zamítnut“; proto samotná emulace prohlížeče není spolehlivější cesta. Cookies ani profil uživatelova Chrome se do backendu nepřenášejí.
- IMDb se importuje z oficiálních non-commercial datasetů; web IMDb se nescrapuje. Tento snapshot zůstává samostatným zdrojem a není podmínkou pro získání ČSFD. Wikidata a běžná stránka DuckDuckGo v Chromium jsou záložní cesty. `MILUJU_FILMY_ONLINE_SEARCH=0` vypne automatické online dohledávání.
- DuckDuckGo HTTP 202 s `challenge-form` / `anomaly-modal` je ochrana proti robotům, nikoli platný prázdný výsledek. Adaptér rozpozná také HTTP 403/429 a ČSFD „Přístup zamítnut“, použije exponenciální odstup a nepokouší se automaticky řešit CAPTCHA. Stav blokace je v `GET /v1/health` a chybějící zdroje se v panelu označí jako nedostupné. Dotazy na zdroje probíhají sériově s odstupem alespoň sekundy.
- Ruční oprava se ukládá po zdrojích podle poskytovatele a content ID (nebo normalizované identity), bez expirace. V „Změnit shodu“ lze vybrat kandidáta nebo vložit HTTPS odkaz na ČSFD. Backend URL ověří, sám načte detail a uloží shodu přes `POST /v1/matches/csfd`; samotná hodnota ratingu se natvrdo nenastavuje.

Pro ruční aktualizaci IMDb zavolejte autorizovaný endpoint `POST /v1/imdb/sync`; jde o velký download a spouští se nanejvýš jednou denně provozním postupem. Import se připraví do nové SQLite databáze a teprve po dokončení se atomicky přepne, takže neúspěch zachová předchozí snapshot.

## Omezení v1

Adaptéry mají obecné veřejné DOM selektory a izolují chybu konkrétní služby. HTML konkrétní videotéky se proto může změnit; před běžným používáním je nutné udělat plánované ruční UAT na přihlášených účtech (3 filmy, 3 seriály a 2 epizody na službu). Firefox/Safari, store publikace a další lokální ratingové zdroje nejsou součástí této verze.

IMDb data jsou určena pouze pro osobní nekomerční použití; zdrojové odkazy v panelu vedou na IMDb a ČSFD. Respektujte prosím [IMDb usage rules](https://help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/G5JTRESSHJBBHTGX) a [ČSFD robots.txt](https://www.csfd.cz/robots.txt).

Unit testy kryjí validační kontrakty, českou diakritiku a rok ve skórování, epizodní značení, registry všech osmi providerů, autorizaci batch lookupu a perzistenci ruční opravy po znovuotevření SQLite.
