# Muziek-tijdlijn

Muziekspel voor een groep vrienden: er speelt een nummer, niemand ziet titel of artiest, en wie aan de beurt is legt het op
de juiste plaats op zijn tijdlijn. Iedereen speelt op zijn eigen gsm in de browser; de muziek komt uit één box, via de
Spotify van de host.

- Site: <https://baaswietse.github.io/muziek-tijdlijn/>
- Privéspel voor eigen gebruik, niet commercieel. Eigen naam en eigen vormgeving.

## Spelregels

1. Iedereen begint met één onthulde kaart: een nummer met zijn jaartal.
2. Wie aan de beurt is, hoort een nummer. Titel en artiest blijven geheim.
3. Die speler legt het nummer op zijn tijdlijn: vóór, tussen of na de kaarten die hij al heeft.
4. Juist: hij houdt de kaart. Fout: de kaart is weg.
5. Het nummer wordt onthuld (artiest, titel, jaar) en de volgende is aan de beurt.
6. Wie eerst 10 kaarten heeft, wint. De host kan dat aantal in de wachtkamer aanpassen (3 tot 20).

Details:

- Hetzelfde jaar als een buurkaart mag ervoor of erna liggen.
- Is de stapel op voor iemand het doel haalt, dan wint wie de meeste kaarten heeft (gelijkspel kan).
- Later instappen kan: je krijgt een startkaart en sluit achteraan aan.
- De host kan een ander nummer vragen (als er een niet afspeelt), een beurt overslaan en een speler verwijderen.
- Een tweede spel in dezelfde kamer herhaalt geen nummers zolang er genoeg ongespeelde zijn.
- De host kiest de nummers: de standaardlijst van het spel of een van zijn eigen Spotify-playlists.

## Hoe het in elkaar zit

```
gsm speler ─┐                         ┌─ tracks.json (op de site)
gsm speler ─┼── WebSocket ── spelserver ┘
gsm host  ──┘        │
   │                 └─ beslist alles: stapel schudden, beurt, juist/fout
   └── Spotify Web API ──> Spotify-toestel van de host ──> box
```

| Map | Wat |
| --- | --- |
| `web/` | De site (Vite + Preact). Staat op GitHub Pages. |
| `server/src/` | De spelregels, los van hoe de server draait. |
| `server/cloudflare/` | De server als Cloudflare Worker met een Durable Object per spel. |
| `server/node/` | Dezelfde server als gewoon Node-programma (eigen server, lokaal testen). |
| `tools/` | Het Python-script dat `tracks.json` maakt, met cache en correcties. |
| `tests/` | Unit-tests en het spelverloop met meerdere browsers (Playwright). |

- **De server is de baas.** De gsm's sturen alleen acties («ik leg het hier») en krijgen bij elke wijziging de volledige
  stand terug. Valt een verbinding weg (scherm vergrendeld, wifi kwijt), dan herverbindt de gsm vanzelf en klopt alles
  meteen weer. Je plaats in het spel zit in een token in de browser, dus ook herladen kan.
- **Het antwoord lekt niet.** Titel, artiest, jaar en track-ID van het lopende nummer gaan pas bij de onthulling naar de
  spelers. Alleen de gsm van de host krijgt het track-ID eerder, omdat die Spotify moet aansturen. Voor de host is het
  dus te vinden voor wie echt wil zoeken; dat kan niet anders zolang zijn gsm de muziek start.
- **Spotify blijft bij de host.** De host logt in met Authorization Code + PKCE, volledig in de browser. Er is geen
  Client Secret, en de tokens gaan nooit naar de spelserver.
- **Twee manieren om geluid te maken.** De site stuurt een Spotify-toestel aan (Spotify Connect): een gsm, laptop, tv
  of box waarop Spotify actief is. Of ze speelt zelf af in de browser van de host («Dit toestel»), met de Web Playback
  SDK van Spotify; dan is er geen Spotify-app nodig.
- **Eigen playlist.** Kiest de host een eigen playlist, dan leest zijn browser de nummers bij Spotify, zoekt de
  jaartallen op bij MusicBrainz en stuurt de lijst naar de server. Die lijst blijft op de server; de andere spelers
  zien alleen de naam en het aantal nummers.

## Eenmalige opzet

### 1. Spotify-app

1. Ga naar <https://developer.spotify.com/dashboard> en maak een app (API: **Web API**).
2. Zet bij **Redirect URIs** exact deze twee:
   - `https://baaswietse.github.io/muziek-tijdlijn/` (met de schuine streep op het einde)
   - `http://127.0.0.1:8765/callback` (voor het script dat de playlist leest)
3. Zet de **Client ID** in `web/src/config.js` (`SPOTIFY_CLIENT_ID`). Die is niet geheim. Een Client Secret is niet nodig
   en hoort niet in de repo.

Wat je moet weten over een Spotify-app in «development mode» (toestand november 2026):

- De eigenaar van de app heeft **Spotify Premium** nodig; zonder werkt de app niet.
- Hoogstens **5 gebruikers** kunnen inloggen, en elk moet je toevoegen onder *Settings → User Management*. Alleen de
  host logt in, dus dat is enkel van belang als iemand anders dan jij host is.
- Afspelen sturen (`PUT /me/player/play`, scopes `user-modify-playback-state` en `user-read-playback-state`) werkt
  alleen met Premium.
- Een playlist uitlezen (`GET /playlists/{id}/items`, scopes `playlist-read-private` en `playlist-read-collaborative`)
  lukt alleen voor playlists waarvan je eigenaar of medewerker bent.
- Afspelen in de browser (Web Playback SDK) vraagt de scopes `streaming`, `user-read-email` en `user-read-private`.
  Daarom vraagt Spotify bij het inloggen ook toegang tot je e-mailadres en je abonnement; het spel doet daar zelf niets
  mee.
- Het Developer Policy van Spotify zegt dat je met hun platform geen spellen of quizzen mag bouwen, en dat een app die
  zelf afspeelt titel en hoes moet tonen. Dit spel doet bewust het omgekeerde. Voor een privéspel onder vrienden is
  het risico dat Spotify de toegang van de app intrekt.

### 2. Spelserver

De server heeft een adres met HTTPS nodig: een site op `https://` mag alleen met een beveiligde `wss://`-verbinding
praten. De server draait op Cloudflare Workers; wie hem liever zelf draait, vindt daaronder hoe.

**A. Cloudflare Workers (gratis plan)**

1. Maak een account op <https://dash.cloudflare.com> en kies een `workers.dev`-subdomein.
2. *Workers & Pages → Create → Import a repository* en kies deze repo. Laat de voorgestelde instellingen staan:
   - Project name: `muziek-tijdlijn` (moet gelijk zijn aan `name` in `wrangler.jsonc`)
   - Deploy command: `npx wrangler deploy`
   - Root directory: de hoofdmap
   
   De namen in het dashboard kunnen licht afwijken. Een build command is niet nodig.
3. Na het uitrollen krijg je een adres zoals `https://muziek-tijdlijn.<jouw-subdomein>.workers.dev`. Zet dat in
   `web/src/config.js` (`DEFAULT_SERVER_URL`).

Controleren of de server draait: open `https://<dat-adres>/api/health`; je krijgt `{"ok":true,...}`.

Vanaf dan rolt Cloudflare de server opnieuw uit bij elke push naar `main`. Liever vanaf je eigen pc (met Node.js):
`npx wrangler login` en daarna `npm run deploy:cf`.

Het gratis plan volstaat ruim: wie over een daglimiet gaat, krijgt fouten tot middernacht (UTC), geen factuur. De server
bewaart elk spel, dus een spel overleeft ook een herstart. Kamers die een halve dag stil liggen, ruimt hij zelf op.

**B. Eigen server (alternatief)**

```bash
docker build -f server/Dockerfile -t muziek-tijdlijn-server .
```

```bash
docker run -d --restart unless-stopped -p 127.0.0.1:8787:8787 -v muziek-tijdlijn:/data muziek-tijdlijn-server
```

De server luistert dan alleen lokaal op poort 8787. Maak hem bereikbaar via HTTPS met een tunnel, bijvoorbeeld
Tailscale Funnel (`tailscale funnel --bg 8787`) of Cloudflare Tunnel. Zo gaat er geen poort open op je router; port
forwarding is af te raden. Zet het HTTPS-adres van de tunnel in `web/src/config.js`.

Het Dockerfile is niet getest. Zonder Docker kan het ook, en die weg is wel getest: `npm ci --omit=dev` en daarna
`npm run server` (Node.js 20 of nieuwer; instellingen via omgevingsvariabelen, zie bovenaan `server/node/server.js`).

De server bevat geen geheimen: geen wachtwoorden en geen Spotify-tokens, alleen namen en tijdlijnen.

### 3. GitHub Pages

De workflow `.github/workflows/pages.yml` bouwt de site en zet ze online bij elke push naar `main`. Ze probeert Pages
zelf aan te zetten. Lukt dat niet (GitHub laat dat niet altijd toe aan een workflow), zet dan één keer
*Settings → Pages → Source* op **GitHub Actions** en start de workflow opnieuw.

## Een spelavond

1. **Host:** open de site, kies *Nieuw spel* en log in bij Spotify.
2. **Host:** kies waar het geluid vandaan komt:
   - *Dit toestel*: het toestel waarop je de site open hebt speelt zelf, via zijn luidspreker of de box waaraan het
     hangt. Er is geen Spotify-app nodig. Laat het scherm aan staan.
   - Een ander toestel uit de lijst: een toestel waarop Spotify actief is. Staat het er niet bij, open er dan de
     Spotify-app, speel even iets af en kom terug.
3. **Host:** tik op *Test het geluid*, en kies eventueel een eigen playlist (zie hieronder).
4. **Spelers:** scan de QR-code of tik de code van 4 letters in.
5. **Host:** start het spel. Elke beurt begint het nummer vanzelf.

### Spelen met een eigen playlist

In de wachtkamer kiest de host onder *Nummers* een van zijn Spotify-playlists. Spotify toont alleen playlists die hij
zelf maakte of waaraan hij meewerkt. Het spel zoekt dan per nummer het jaar van de eerste release op bij MusicBrainz.

- Dat opzoeken duurt de eerste keer ongeveer 3 seconden per nummer (MusicBrainz laat 1 verzoek per seconde toe). Alles
  wat opgezocht is, onthoudt de browser van de host; een tweede keer gaat het meteen.
- Nummers uit de standaardlijst van het spel zijn al nagekeken en worden niet opnieuw opgezocht.
- Na afloop toont het spel de jaartallen waar Spotify en MusicBrainz het oneens zijn. De host kan ze daar verbeteren;
  ook dat wordt onthouden. Die lijst verklapt wel antwoorden.
- Een lijst telt minstens 10 en hoogstens 500 nummers. Dubbels en nummers zonder jaartal doen niet mee.

### De titel geheim houden voor de host

De Spotify-app op het toestel van de host toont titel en hoes in de melding, op het vergrendelscherm en in de app zelf.
Een box of auto met een schermpje kan de titel ook tonen.

- Speel je met *Dit toestel*, dan toont het toestel geen titel: de speler in de browser zet niets in de
  mediabediening.
- Het spel houdt het scherm wakker, zodat het vergrendelscherm niet verschijnt zolang de pagina open staat.
- Trek de meldingenbalk niet open en open de Spotify-app niet tijdens een beurt.
- Android: zet *Instellingen → Geluid → Media → Media op vergrendelscherm tonen* uit (de naam verschilt per merk).
- Het zekerst: hang een ander toestel aan de box (oude gsm, tablet of laptop met Spotify open, scherm naar beneden)
  en kies dat in de toestellenlijst. De gsm van de host stuurt dan alleen aan.

### Als er iets hapert

| Probleem | Oplossing |
| --- | --- |
| Toestel niet in de lijst | Open de Spotify-app op dat toestel, speel even iets af en kom terug. Of kies *Dit toestel*. |
| *Dit toestel* geeft geen geluid | Tik op *Opnieuw afspelen*. Na het herladen van de pagina eerst opnieuw op *Dit toestel* tikken. |
| «Spotify vindt het toestel niet» | Hetzelfde; tik daarna op *Opnieuw afspelen*. |
| «Spotify weigert dit commando» | Geen Premium, of het account staat niet bij *User Management* van de app. |
| Een nummer speelt niet af | *Ander nummer* (host): dezelfde speler krijgt een nieuw nummer. |
| Iemand is even weg | *Sla beurt over* (host). |
| Scherm was vergrendeld | Niets doen: de gsm herverbindt vanzelf. |

## Nummers en jaartallen bijwerken

Dit gaat over de standaardlijst van het spel, de lijst waarmee iedereen kan spelen zonder iets te kiezen. Voor een
eigen playlist is het script niet nodig: zie *Spelen met een eigen playlist*.

`web/public/tracks.json` bevat per nummer: Spotify track-ID, artiest, titel, jaar en de bron van dat jaar
(`musicbrainz`, `spotify` of `handmatig`). Het script `tools/tracks.py` maakt dat bestand.

Spotify geeft alleen de datum van het album, en dat is vaak een remaster of compilatie. Het script zoekt daarom per
nummer het jaar van de eerste release op bij MusicBrainz, en neemt het vroegste van de twee. Bij MusicBrainz tellen
alleen officiële studio-uitgaven: bootlegs, live-albums en demo's zijn er vaak fout of veel te vroeg gedateerd.

Draaien op Windows (Python 3.9 of nieuwer, geen extra pakketten):

```bash
python tools/tracks.py
```

Een andere playlist:

```bash
python tools/tracks.py --playlist https://open.spotify.com/playlist/JOUW_PLAYLIST
```

- Je browser opent Spotify om in te loggen. De Client ID leest het script uit `web/src/config.js`.
- De playlist moet van jou zijn (of je bent medewerker), anders weigert Spotify.
- MusicBrainz laat 1 verzoek per seconde toe; 100 nieuwe nummers duren een paar minuten. De antwoorden staan in
  `tools/musicbrainz-cache.json`, dus een tweede keer gaat snel. Met `--opnieuw` zoekt het alles opnieuw op.
- `tools/playlist.json` is de laatst opgehaalde lijst. Met `--invoer tools/playlist.json` draai je zonder Spotify-login.

**Nakijken.** `tools/tracks-nakijken.md` somt op wat je best controleert: nummers waar Spotify en MusicBrainz meer dan
een jaar verschillen, nummers die MusicBrainz niet vond, live-opnames en dubbels. Onderaan staat de volledige lijst op
jaar, om snel te overlopen. MusicBrainz is door vrijwilligers ingevuld en niet foutloos.

**Verbeteren.** Zet het juiste jaar in `tools/correcties.json` en draai het script opnieuw:

```json
{
  "5IX4TbIR5mMHGE4wiWwKW0": { "year": 1989, "note": "single uit 1989" }
}
```

Commit daarna `web/public/tracks.json` en de bestanden in `tools/`. Na de push naar `main` staat de nieuwe lijst online;
de server haalt ze bij de start van elk spel opnieuw op.

## Ontwikkelen en testen

```bash
npm install
```

Lokaal draaien (twee vensters): de server met de testnummers, en de site.

```bash
TRACKS_FILE=tests/fixtures/tracks.json npm run server
```

```bash
VITE_SERVER_URL=http://127.0.0.1:8787 npm run dev
```

Open dan <http://127.0.0.1:5173/muziek-tijdlijn/?mock=1>. Met `?mock=1` is Spotify nagebootst: geen login en geen
geluid, maar het hele spel werkt (`?mock=0` zet het weer uit).

| Commando | Wat |
| --- | --- |
| `npm test` | Unit-tests van de spelregels. |
| `npm run test:py` | Unit-tests van het script voor de jaartallen (zonder netwerk). |
| `npm run test:e2e` | Spelverloop met meerdere browsers tegen de Node-server. |
| `MT_SERVER=cloudflare npm run test:e2e` | Hetzelfde tegen de Cloudflare-variant (lokaal via wrangler). |
| `npm run test:live` | Hetzelfde tegen de echte site op GitHub Pages en de echte spelserver. Spotify blijft nagebootst. |

De workflow `.github/workflows/ci.yml` draait dit alles bij elke pull request.

### Wat de tests wel en niet dekken

Gedekt, automatisch:

- De spelregels: plaatsen, gelijke jaren, winnen, lege stapel, overslaan, verwijderen, laat instappen.
- Een volledig spel met drie browsers: binnenkomen via code en via de QR-link, live tijdlijnen en scores, onthulling,
  winnaar, nog een spel.
- Dat het antwoord niet in de netwerkdata van gewone spelers zit vóór de onthulling.
- Herverbinden na een weggevallen verbinding en na herladen; een herlaad bij de host start het nummer niet opnieuw.
- De Spotify-laag van de site tegen een nagebootste Spotify op netwerkniveau: inloggen met PKCE (zonder Client
  Secret), een toestel kiezen, het juiste nummer op het juiste toestel starten, een verlopen token vernieuwen en
  foutmeldingen bij een verdwenen toestel of een account zonder Premium.
- Afspelen op *Dit toestel* tegen een nagebootste Spotify-speler, en een eigen playlist tegen een nagebootste
  MusicBrainz: nummers lezen, jaartallen kiezen, twijfelgevallen verbeteren en ermee spelen.
- De regels voor het kiezen van een jaartal (dezelfde in de browser en in het Python-script).
- Beide servervarianten (Node en Cloudflare, lokaal), en met `npm run test:live` de uitgerolde site en server.

Niet gedekt, alleen in het echt te testen:

- Inloggen bij de echte Spotify en het echte afspelen op een toestel.
- De echte Spotify-speler in de browser (*Dit toestel*), zeker op een gsm.
- Het gedrag van de Spotify-app op jouw gsm (melding, vergrendelscherm) en van je box.
