# Muziek-tijdlijn

Muziekspel voor een groep vrienden: er speelt een nummer, niemand ziet titel of artiest, en wie aan de beurt is legt het op
de juiste plaats op zijn tijdlijn. Iedereen speelt op zijn eigen gsm in de browser; de muziek komt uit één box, via de
Spotify van de host.

- Site: <https://baaswietse.github.io/muziek-tijdlijn/>
- Privéspel voor eigen gebruik, niet commercieel. Eigen naam en eigen vormgeving.

## Spelregels

1. Iedereen begint met één onthulde kaart (een nummer met zijn jaartal) en 2 tokens.
2. Wie aan de beurt is, hoort een nummer. Titel en artiest blijven geheim.
3. Die speler legt het nummer op zijn tijdlijn: vóór, tussen of na de kaarten die hij al heeft.
4. Juist: hij houdt de kaart. Fout: de kaart is weg.
5. Het nummer wordt onthuld (artiest, titel, jaar) en de volgende is aan de beurt.
6. Wie eerst 10 kaarten heeft, wint. De host kan dat aantal in de wachtkamer aanpassen (3 tot 20).
7. Raden voor een token: vóór de onthulling mag wie aan de beurt is hardop artiest en nummer raden. Fout of geen idee?
   Dan mag de volgende in de beurtvolgorde, enzovoort. Wie het eerst juist heeft, krijgt een token extra: na de onthulling
   tikt de speler aan beurt of de host op diens naam, of eist die speler het zelf op.
8. Een token inzetten: heeft iemand anders dan de speler aan beurt een token, dan ligt na het leggen de gekozen plaats
   eerst vast en kiest elke andere speler met een token: een ándere, nog vrije plaats op diens tijdlijn (1 token, één
   keer per beurt) of *Ik zet geen token in*. Pas als iedereen koos, tikt de speler aan beurt of de host op *Onthul*.
   Lag de speler aan beurt juist, dan houdt hij de kaart.
   Lag hij fout, dan krijgt de eerste inzetter die juist lag de kaart op zijn eigen tijdlijn. Ingezette tokens zijn
   altijd op.
9. Een kaart kopen: op je eigen beurt, voor je een plaats bevestigt, kan je 3 tokens betalen om de kaart van het
   nummer dat speelt meteen juist op je tijdlijn te krijgen. Je laatste kaart (bij een doel van 10 je 10e, dus wanneer
   je er al 9 hebt) kan je niet kopen: die moet je verdienen door juist te leggen.

Details:

- Hetzelfde jaar als een buurkaart mag ervoor of erna liggen.
- Is de stapel op voor iemand het doel haalt, dan wint wie de meeste kaarten heeft (gelijkspel kan).
- Later instappen kan: je krijgt een startkaart en sluit achteraan aan.
- De host kan een ander nummer vragen (als er een niet afspeelt), een beurt overslaan en een speler verwijderen.
- Een tweede spel in dezelfde kamer herhaalt geen nummers zolang er genoeg ongespeelde zijn.
- De host kiest de nummers: de standaardlijst van het spel of een van zijn eigen Spotify-playlists.
- Tokens: hoogstens één per beurt, ook nog bij de kaart die het spel beslist. De host en de speler aan beurt kunnen
  het aan eender wie geven, verplaatsen of terugnemen; een andere speler kan het alleen voor zichzelf opeisen zolang
  niemand het heeft, en het weer teruggeven. Iedereen ziet de tellers op het bord en op het eindscherm. Elk spel
  begint weer met 2 tokens per speler, ook "Nog een spel"; wie laat instapt, krijgt er ook 2. Daarbovenop verdien je
  tokens alleen door te raden.
- Inzetten: omdat iedereen met tokens begint, komt na het leggen bijna altijd de tussenfase met *Onthul*. Heeft geen
  enkele andere speler nog een token (allemaal ingezet, of je speelt alleen), dan volgt de onthulling meteen. Zijn
  alle andere plaatsen al bezet, dan kan je niet meer inzetten en hou je je tokens. Wie eerst inzet, heeft die
  plaats. Gelijke jaren mogen ook hier aan beide kanten. Krijgt een inzetter zo zijn laatste kaart, dan wint hij.
  *Ander nummer* of *Sla beurt over* tijdens het inzetten geeft de tokens terug, net als het verwijderen van de speler
  aan beurt. Het raad-token van een beurt kan je pas in een latere beurt inzetten.
- Het spelscherm toont één ding per moment. Bovenaan een balk met links *Stand* (je eigen kaarten en tokens; een tik
  toont alle spelers, wie aan de beurt is en wie niet verbonden is, het beurtnummer en hoeveel nummers er nog in de
  stapel zitten) en rechts het menu (spelcode, spelregels, het spel verlaten, en voor de host de muziek, *Ander
  nummer*, *Sla beurt over*, een speler verwijderen en *Stop dit spel*). Daaronder één regel uitleg en één tijdlijn:
  die waarop nu gespeeld wordt. Tijdens andermans beurt wissel je tussen zijn tijdlijn en de jouwe; via de stand kan
  je elke tijdlijn bekijken. Een probleem met de muziek ziet de host als één regel met een knop op het spelscherm
  zelf, niet alleen in het menu.
- De knop die je nodig hebt, staat altijd op dezelfde plek: in een zwevende balk onderaan, in beeld zonder scrollen,
  ook bij een lange tijdlijn. Na elkaar: *Leg het …* (aan beurt), *Ik zet geen token in* (wie nog moet kiezen; een
  host die moet kiezen, kiest eerst en krijgt daarna *Onthul*), *Onthul* (aan beurt en host; uitgeschakeld met op wie
  er gewacht wordt), *Volgende beurt* en op het einde (host) *Nog een spel*. Een nieuwe knop reageert even (0,9 s)
  niet, zodat een dubbele tik nooit twee stappen doet. Meldingen verschijnen boven de balk.
- De onthulling (ook van een gekochte kaart, en op het einde met de winnaars) schuift als paneel van onderaan over de
  tijdlijn, net boven de balk: oordeel, jaar, titel, artiest, wat er met de tokens gebeurde en wie het raad-token
  krijgt. De tijdlijn eronder verspringt niet; de nieuwe kaart staat er gemarkeerd in. Veeg het paneel naar onder of
  tik op *Verberg* om de tijdlijnen te bekijken; de strook die overblijft opent het weer. Bij de volgende beurt
  verdwijnt het vanzelf.
- Leggen gaat door te slepen: bij het begin van je beurt ligt de kaart met het vraagteken in een houder net boven de
  zwevende balk. Sleep ze in je tijdlijn: de kaarten schuiven uit elkaar waar ze zou landen. Loslaten legt ze daar
  als voorlopige keuze (pas dan gaat die naar de server, zodat de anderen zien waar je twijfelt); opnieuw slepen
  verplaatst ze, terug naar de houder slepen maakt de keuze ongedaan, en *Leg het …* in de balk bevestigt. Sleep je
  tot bij de boven- of onderrand, dan schuift de tijdlijn mee; bij veel kaarten worden ze compacter. Zonder slepen
  kan het ook: de knoppen omhoog/omlaag op de kaart (of de pijltjestoetsen) schuiven ze één plaats op, en elke plaats
  heeft een naam voor schermlezers ("tussen 1984 en 1991"). Een afgebroken gebaar (scherm gedraaid, verbinding weg,
  beurt voorbij) legt de kaart terug waar ze lag.
- Inzetten gaat in twee stappen: je token naar een vrije plaats slepen zet nog niets in (daar staat "Nog niet
  ingezet"; een bezette plaats neemt het token niet aan), pas de knop *Zet token hier* bij het token doet het. Daarna zie je meteen hoeveel tokens je nog hebt. Lukt het versturen niet
  (geen verbinding, of geen antwoord binnen enkele seconden), dan blijft je keuze staan en zegt het scherm dat je token
  nog niet ingezet is. Wordt er onthuld voor je bevestigde, dan zegt je scherm dat je token niet ingezet is en dat je
  het nog hebt (dat kan alleen nog na de noodknop van de host, of als je verbinding wegviel).
- Kopen gaat in twee stappen (*Koop deze kaart voor 3 tokens* en dan bevestigen), zodat een verkeerde tik niets kost.
  Na het kopen komt er geen tussenfase (niemand kan tegen een gekochte kaart inzetten), wel de gewone onthulling,
  gemarkeerd als gekocht en met hoeveel tokens de koper nog heeft. Het raad-token kan daarbij nog gegeven worden. Met
  minder dan 3 tokens zie je geen koopknop; ben je één kaart van het doel, dan zegt het scherm waarom kopen niet kan.
- Kiezen voor de onthulling: *Onthul* blijft uitgeschakeld zolang er nog iemand moet kiezen, en elk scherm zegt op wie
  er gewacht wordt. Moeten kiezen doet elke andere speler die nu kán inzetten: hij heeft een token, zette deze beurt
  nog niet in, paste nog niet, en er is nog een vrije plaats. Wie geen token heeft, of wie geen vrije plaats meer vindt
  (bv. omdat een ander net de laatste nam), hoeft niets te doen. *Ik zet geen token in* is definitief voor die beurt.
  Wie laat instapt, heeft 2 tokens en kiest dus ook mee; wie verwijderd wordt, telt niet meer. *Ander nummer* en *Sla
  beurt over* wissen alle keuzes. Onthullen gebeurt nooit vanzelf: ook als iedereen koos, blijft het een tik.
- Niemand kan het spel blokkeren: wie niet verbonden is, telt niet mee (komt hij terug voor de onthulling, dan moet hij
  weer kiezen). Reageert iemand niet terwijl hij wel verbonden is, dan kan de host (ook als hij niet aan beurt is) met
  *Reageert er iemand niet? Toch onthullen…* toch onthullen, na een bevestiging die zegt op wie er nog gewacht wordt.
  Wie zo niet koos, zet niets in en houdt zijn tokens. Een speler aan beurt die geen host is, kan dat niet.

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
- **Acties.** Een gsm stuurt `{ t: 'hello', token }` om zich aan te melden en daarna een van deze acties: `start`,
  `settings`, `clearDeck`, `select`, `place`, `challenge` (met `index`: een token inzetten), `pass` (deze beurt geen
  token inzetten), `reveal` (einde van het inzetten, pas als iedereen koos; de host kan met `force: true` toch
  onthullen), `buy` (op je eigen beurt de kaart kopen voor 3 tokens), `next`, `token` (met `playerId` van wie het token van deze beurt krijgt; leeg neemt het terug),
  `skipTrack`, `skipTurn`, `remove` en `lobby`. De server antwoordt met `{ t: 'state' }` of
  `{ t: 'error', code, message }`. Zie `server/src/room.js`.
- **Spotify blijft bij de host.** De host logt in met Authorization Code + PKCE, volledig in de browser. Er is geen
  Client Secret, en de tokens gaan nooit naar de spelserver.
- **Twee manieren om geluid te maken.** De site stuurt een Spotify-toestel aan (Spotify Connect): een gsm, laptop, tv
  of box waarop Spotify actief is. Of ze speelt zelf af in de browser van de host («Dit toestel»), met de Web Playback
  SDK van Spotify; dan is er geen Spotify-app nodig.
- **Het juiste nummer, nagekeken.** Spotify voert player-commando's niet gegarandeerd in volgorde uit, een toestel kan
  «gelukt» antwoorden zonder over te schakelen, en een commando kan mislukken of pas laat aankomen. Dan speelde vroeger
  het vorige nummer gewoon verder (met herhalen zelfs opnieuw van voren) terwijl het spel een nieuw verwachtte. Nu
  (`web/src/lib/playback.js`):
  - gaan alle commando's één voor één door één wachtrij; een commando van een vorige beurt dat nog wacht, vervalt en
    komt dus nooit na het startcommando van een nieuwe beurt;
  - kijkt het spel na het starten na wat er echt speelt (de Web API `GET /me/player` met `market=from_token`, of bij
    *Dit toestel* de toestand van de speler in de browser) en vergelijkt dat met het verwachte nummer, ook als Spotify
    een andere versie speelt («track relinking»: een ander track-ID, met het gevraagde in `linked_from`). Klopt het
    niet, dan start het nog hoogstens twee keer opnieuw; bij storingen (502, 429, geen antwoord na 10 s) wacht het
    even (bij 429 zo lang als Spotify vraagt, hoogstens 10 s);
  - zet het, als het toch niet lukt, het verkeerde nummer stil en krijgt de host een waarschuwing met één knop
    *Start het juiste nummer*, op het spelscherm zelf (niet alleen in het menu). Die zegt nooit welk nummer er wel
    speelt;
  - telt een nummer pas als gestart als dat bevestigd is (`mt.lastPlayed`); na een herlaad kijkt het spel één keer na
    of het nog klopt, en ook als de host terugkomt op het scherm;
  - gaat het herhalen («dit nummer») pas aan na een bevestigde start, en alleen voor dat nummer. Herhalen blijft: zonder
    begint Spotify na afloop zelf iets anders (aanbevelingen), dat de spelers voor het nummer van de beurt kunnen
    houden, terwijl het spel het vorige nummer nu herkent en rechtzet;
  - volgt het bij *Dit toestel* de speler: verbindt Spotify hem opnieuw (soms met een ander id), dan speelt het spel
    verder op het nieuwe id; meldt hij een ander nummer dan verwacht, dan herstelt het spel dat (hoogstens drie keer
    per beurt). Valt hij langer dan 8 s weg, dan zet het spel hem stil en zegt het dat.
  - Een beurt kost zo 4 verzoeken naar Spotify: starten, één controle, herhalen aan en een nacontrole na 8 s (voor een
    commando dat Spotify pas laat uitvoert). Bij *Dit toestel* 2 (de controles vraagt het aan de speler zelf). Gaat er
    iets mis, dan hoogstens een tiental. Ruim onder wat Spotify toelaat.
- **Eigen playlist.** Kiest de host een eigen playlist, dan leest zijn browser de nummers bij Spotify, zoekt de
  jaartallen op bij MusicBrainz en stuurt de lijst naar de server. Die lijst blijft op de server; de andere spelers
  zien alleen de naam en het aantal nummers.
- **Gedeelde jaartallen.** Wat een host opzocht, bewaart de server in één gedeelde lijst voor alle spellen: per
  Spotify-track-ID het jaar, de bron (`musicbrainz`, `spotify`, `onbekend` of `handmatig`), eventuele twijfels en de
  regelversie voor remixes. Geen titels, geen namen, geen persoonsgegevens. Alleen de host van een bestaand spel kan
  erin lezen of schrijven (met de geheime sleutel van zijn plaats in dat spel); gasten niet, want de lijst verklapt
  antwoorden. Een handmatige verbetering gaat voor op een opgezocht jaar en wordt daar nooit door overschreven; een
  nieuwere verbetering vervangt een oudere. Op Cloudflare staat de lijst in een tweede Durable Object (`YearStore`,
  één exemplaar, SQLite); de Node-server houdt ze in het geheugen en in `DATA_FILE` als dat ingesteld is.
- **Routes.** `POST /api/rooms` (spel maken), `POST /api/rooms/:code/join`, `POST /api/rooms/:code/deck` (eigen
  lijst van de host), de WebSocket `/api/rooms/:code/ws`, en voor de gedeelde jaartallen
  `POST /api/rooms/:code/years/lookup` met `{ token, ids }` (hoogstens 500 track-ID's; antwoord `{ years: { id: { y,
  s, d, r } } }` met alleen wat gekend is) en `POST /api/rooms/:code/years` met `{ token, entries: [{ id, y, s, d, r
  }] }` (hoogstens 500; antwoord `{ ok, saved, skipped }`). Ongeldige items worden overgeslagen; zie
  `server/src/yearlist.js`.

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
De gedeelde lijst met jaartallen blijft wel staan. Ook die maakt `wrangler deploy` zelf aan (de migratie `v2` in
`wrangler.jsonc`); in het dashboard hoeft daarvoor niets.

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

De server bevat geen geheimen: geen wachtwoorden en geen Spotify-tokens, alleen namen en tijdlijnen, en de gedeelde
lijst met jaartallen (track-ID, jaar, bron, twijfels).

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
4. **Spelers:** scan de QR-code of tik de code van 4 letters in. Via de QR-code (of de gedeelde link) kom je meteen
   in het spel: kent je gsm je naam nog van een vorige keer, dan zit je zonder iets in te vullen in de wachtkamer;
   anders vul je enkel je naam in. Instappen in een spel dat al loopt kan ook: je krijgt dan een startkaart.
   - Zat je nog in een ander spel als gast, dan stap je meteen over; je oude plaats blijft daar als offline speler
     staan, net als bij *Verlaat het spel*.
   - Ben je host van een ander spel, dan vraagt de site eerst of je overstapt: zonder host valt dat spel stil.
   - Is je naam al bezet, of is de server even onbereikbaar, dan kies je een andere naam of tik je opnieuw. Bestaat
     het spel niet (meer) of zit het vol, dan krijg je een melding en blijf je waar je was.
5. **Host:** start het spel. Elke beurt begint het nummer vanzelf.

### Als app op het beginscherm

De site kan als app op je beginscherm, met een eigen icoon en zonder adresbalk.

- **Android (Chrome):** open de site, tik op het menu (⋮) en kies *App installeren* of *Toevoegen aan startscherm*.
- **iPhone (Safari):** open de site, tik op de deelknop en kies *Zet op beginscherm*.

Goed om te weten:

- Een QR-code scannen opent de browser, niet de app (op iPhone altijd). Spelers doen dus gewoon mee in de browser.
- Op iPhone heeft de app een eigen geheugen, los van Safari: je naam, een lopend spel en de Spotify-login moet je er
  opnieuw invullen of opnieuw doen.
- Het loont vooral voor de host, die de site elke spelavond opent.

### Spelen met een eigen playlist

In de wachtkamer kiest de host onder *Nummers* een van zijn Spotify-playlists. Spotify toont alleen playlists die hij
zelf maakte of waaraan hij meewerkt. Het spel zoekt dan per nummer het jaar van de eerste release op bij MusicBrainz.

- **Je hoeft niet te wachten.** Wat al gekend is (een eigen verbetering, de standaardlijst, de gedeelde lijst op de
  server, wat de browser onthield) is er meteen. Zodra er 10 nummers met een jaartal klaar zijn, kan de host starten.
  Het scherm zegt hoeveel nummers klaar zijn, hoeveel er nog opgezocht worden en hoe lang dat ongeveer nog duurt.
- De rest wordt op de achtergrond opgezocht, in willekeurige volgorde: wie vroeg start, speelt met een greep uit de
  hele playlist en niet alleen met het begin ervan. Het opzoeken loopt door in de wachtkamer en tijdens het spel, op
  de gsm van de host, en gaat na een herlaad verder waar het was. Wat er tijdens een spel bijkomt, doet mee vanaf het
  volgende spel (*Nog een spel* of vanuit de wachtkamer): de stapel van een lopend spel verandert nooit. Dat geldt ook
  als de gsm van de host intussen herlaadde: de volledige lijst gaat na het spel toch mee.
- **Een evenwichtige greep.** Wat al gekend is, is geen willekeurige greep uit je playlist: de standaardlijst van het
  spel is bv. rock en metal, dus de nummers van je playlist die daarin staan, zijn meteen klaar. Zolang er nog
  opgezocht wordt, gaan van die gekende nummers er daarom maar zoveel mee als er van de rest al opgezocht is (zoveel
  procent), aangevuld tot genoeg voor een volledig spel (2 kaarten per speler per kaart van het doel). Start je heel
  vroeg, dan zitten er toch vooral gekende nummers in: het scherm zegt dat, en hoe lang het nog duurt voor de greep
  evenwichtig is. Voorbeeld, een mix van 500 nummers met 60 gekende rocknummers en 4 spelers: meteen starten geeft
  zo'n 86% rock in het eerste spel, na 2 minuten 12% (vroeger nog 43%), en dat is ook het aandeel in de playlist. Het
  scherm toont ook met hoeveel van de nummers van de playlist een spel speelt.
- *Stop met opzoeken* houdt wat al klaar is; de playlist later opnieuw kiezen zoekt alleen de rest op. Een andere
  playlist of *Terug naar de standaardlijst* stopt het opzoeken ook.
- Het opzoeken kost gemiddeld anderhalf verzoek per nummer, en MusicBrainz laat 1 verzoek per seconde toe: reken de
  eerste keer op ongeveer 2 seconden per nummer, 500 nieuwe nummers duren zo'n kwartier. Alles
  wat opgezocht is, onthoudt de browser van de host en gaat ook naar de gedeelde lijst op de server. Een tweede keer
  gaat het meteen, ook op een ander toestel, in een andere browser of bij een andere host. Op de server staan alleen
  track-ID, jaar, bron en twijfels; alleen een host van een lopend spel kan ze lezen of aanvullen.
- Is de server even niet bereikbaar of kent hij de gedeelde lijst nog niet, dan gaat alles zoals voordien, met wat
  de browser onthield en MusicBrainz.
- Nummers uit de standaardlijst van het spel zijn al nagekeken en worden niet opnieuw opgezocht.
- Een remix krijgt het jaar van de remix, niet dat van het origineel: de spelers horen de remix. Dat zie je aan de
  titel ("- X Remix", "(X Remix)", ook "Rework", "Bootleg", "Mashup" en "Refix"). "Radio Edit", "Extended Mix" of
  "Remastered" tellen als het origineel. Kent MusicBrainz de remix niet, dan geldt het jaar van het Spotify-album.
- Het spel toont de jaartallen waar Spotify en MusicBrainz het oneens zijn, ook al terwijl de rest nog opgezocht
  wordt. De host kan ze daar verbeteren;
  ook dat wordt onthouden en gedeeld, apart gemarkeerd als handmatig, zodat het ook voor andere hosts geldt. Die lijst
  verklapt wel antwoorden.
- Een lijst telt minstens 10 en hoogstens 500 nummers. Dubbels en nummers zonder jaartal doen niet mee. Heeft de
  playlist meer dan 500 nummers, dan kiest het spel er willekeurig 500 uit en zoekt alleen daarvan het jaar op; een
  volgende keer is dat een andere greep.

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
| «Speelt niet het nummer van deze beurt» | Het toestel bleef bij een ander nummer (meestal het vorige), ook na een paar pogingen. Het spel zette het stil. Tik op *Start het juiste nummer*. Gebeurt het vaak met een box of tv, kies dan *Dit toestel* of een gsm/laptop aan de box. |
| Het vorige nummer begint opnieuw | Het spel merkt dat nu zelf en start het juiste nummer. Gebeurt het toch, dan was de gsm van de host waarschijnlijk vergrendeld of de site stond op de achtergrond: dan kan de site Spotify niet aansturen tot je terug bent. Hou de site open op het scherm. |
| «Spotify vindt het toestel niet» | Hetzelfde; tik daarna op *Opnieuw afspelen*. |
| «Spotify weigert dit commando» | Geen Premium, of het account staat niet bij *User Management* van de app. |
| Een nummer speelt niet af | *Ander nummer* (host): dezelfde speler krijgt een nieuw nummer. |
| Iemand is even weg | *Sla beurt over* (host). |
| Scherm was vergrendeld | Niets doen: de gsm herverbindt vanzelf en kijkt na of het juiste nummer speelt. |
| *Test het geluid* staat uit | Tijdens een spel zou de test het nummer van de beurt onderbreken: gebruik dan *Opnieuw afspelen*. |

## Nummers en jaartallen bijwerken

Dit gaat over de standaardlijst van het spel, de lijst waarmee iedereen kan spelen zonder iets te kiezen. Voor een
eigen playlist is het script niet nodig: zie *Spelen met een eigen playlist*.

`web/public/tracks.json` bevat per nummer: Spotify track-ID, artiest, titel, jaar en de bron van dat jaar
(`musicbrainz`, `spotify` of `handmatig`). Het script `tools/tracks.py` maakt dat bestand.

Spotify geeft alleen de datum van het album, en dat is vaak een remaster of compilatie. Het script zoekt daarom per
nummer het jaar van de eerste release op bij MusicBrainz, en neemt het vroegste van de twee. Bij MusicBrainz tellen
alleen officiële studio-uitgaven: bootlegs, live-albums en demo's zijn er vaak fout of veel te vroeg gedateerd.
Een remix krijgt het jaar van die remix zelf; vindt MusicBrainz ze niet, dan het jaar van het Spotify-album (en
nooit dat van het origineel). "Edit", "Mix" en "Remastered" zonder het woord "remix" tellen als het origineel.

Zo zoekt het (in het script en in de browser hetzelfde): eerst op titel en artiest. Passen alle opnames op één pagina
(hoogstens 100), dan is dat genoeg: 1 verzoek. Bekende nummers hebben honderden opnames; dan volgt één gericht verzoek
naar de opnames die vóór het gevonden jaar voor het eerst uitkwamen. Is die pagina volledig, dan bestaat er zeker
geen vroegere officiële uitgave: een officiële uitgave is nooit vroeger dan de eerste release van haar opname. Alleen
als de eerste pagina geen officiële studio-uitgave bevat, of als ook de oudere opnames niet op één pagina passen, komt
er een verzoek bij met alleen officiële studio-uitgaven. Gemiddeld kost een nummer zo anderhalf verzoek.

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

- De spelregels: plaatsen, gelijke jaren, winnen, lege stapel, overslaan, verwijderen, laat instappen, tokens.
- Tokens met drie browsers: geven, verplaatsen, opeisen en terugnemen, wie de knoppen ziet, tellers over beurten heen
  en na herverbinden, 2 tokens bij de start en weer 2 bij een nieuw spel, en een token inzetten (gewonnen en verloren,
  alle plaatsen bezet, zonder lek van het antwoord), en meteen onthullen zodra de anderen hun tokens op hebben. Ook
  dat een gekozen maar niet bevestigde plaats niets kost en dat het scherm dat zegt, dat de bevestigknop op een
  kleine gsm (390×600) in beeld en niet bedekt is, en wat je ziet als bevestigen mislukt (geen verbinding, of een
  verbinding die niets doorlaat). En dat *Onthul* uit blijft tot iedereen met een token koos (passen of inzetten), dat
  wie wegvalt niets blokkeert maar na zijn terugkeer weer moet kiezen, en de noodknop van de host. En een kaart kopen:
  een derde token verdienen, kopen in twee stappen, wat iedereen dan ziet, en niet voor de laatste kaart.
- Slepen, met de muis en met de vinger (touch): de kaart van de houder naar een plaats, verplaatsen, terug naar de
  houder, de kaarten die plaats maken, automatisch meeschuiven op een lange tijdlijn, en afgebroken gebaren
  (`pointercancel`, scherm gedraaid, verbinding weg, beurt voorbij); de knoppen omhoog/omlaag en de pijltjestoetsen
  met hun namen; een token slepen (niet op een bezette plaats) en bevestigen; dat de keuze pas bij het loslaten
  naar de server gaat. De onthulling als paneel (de tijdlijn verspringt niet, wegvegen en weer openen, weg bij de
  volgende beurt) en de stand en het menu openen en sluiten.
- De zwevende balk: *Leg het*, *Onthul* en *Volgende beurt* op exact dezelfde plek, een dubbele tik doet geen twee
  stappen, een melding bedekt de knop niet, en op een kleine gsm (390×600) met 9 kaarten staat elke verplichte knop
  voor elke rol en fase in beeld, net als de uitkomst na de onthulling.
- Een volledig spel met drie browsers: binnenkomen via code en via de QR-link, live tijdlijnen en scores, onthulling,
  winnaar, nog een spel.
- Binnenkomen via de QR-link: met en zonder gekende naam, vanuit een ander spel als gast of als host (met de vraag
  of je overstapt), naar je eigen spel, naar een onbestaand spel, met een bezette naam en zonder netwerk.
- Dat het antwoord niet in de netwerkdata van gewone spelers zit vóór de onthulling.
- Herverbinden na een weggevallen verbinding en na herladen; een herlaad bij de host start het nummer niet opnieuw.
- De Spotify-laag van de site tegen een nagebootste Spotify op netwerkniveau: inloggen met PKCE (zonder Client
  Secret), een toestel kiezen, het juiste nummer op het juiste toestel starten, een verlopen token vernieuwen en
  foutmeldingen bij een verdwenen toestel of een account zonder Premium.
- Afspelen op *Dit toestel* tegen een nagebootste Spotify-speler, en een eigen playlist tegen een nagebootste
  MusicBrainz: nummers lezen, jaartallen kiezen, twijfelgevallen verbeteren en ermee spelen.
- Het juiste nummer door de boxen tegen een nagebootste Spotify die zich slecht gedraagt (`tests/e2e/playback.spec.js`):
  een startcommando dat mislukt (502, 429), «gelukt» zonder over te schakelen, een commando dat pas laat uitgevoerd
  wordt (omgekeerde volgorde), een toestel dat vast blijft hangen op het vorige nummer (waarschuwing zonder titel),
  track relinking met en zonder `linked_from`, herladen terwijl er iets anders speelt, het aantal verzoeken per beurt,
  en bij *Dit toestel*: een speler die opnieuw verbindt met een ander id, een vorig nummer dat opnieuw begint en een
  herkansing van een vorig startcommando. De wachtrij en het vergelijken van nummers ook als unit-test.
- De gedeelde jaartallen: een tweede host (ander toestel, ander spel) doet geen enkel verzoek naar MusicBrainz en krijgt
  de verbeteringen van de eerste; gasten en onbestaande spellen worden geweigerd; zonder die routes op de server (een
  oudere server, of onbereikbaar) werkt een playlist zoals vroeger. De verzonnen nummers krijgen bij elke run nieuwe
  ID's, zodat ook `npm run test:live` herhaalbaar is; zo'n run laat 8 rijen achter in de echte gedeelde lijst.
- Een eigen playlist zonder wachten, tegen een trage nagebootste MusicBrainz: starten terwijl er nog opgezocht wordt,
  doorzoeken tijdens het spel zonder de stapel van dat spel te raken en meer nummers in het volgende spel, verder na
  een herlaad, een willekeurige greep uit een playlist van meer dan 500 nummers, en stoppen, een andere playlist of
  de standaardlijst kiezen midden in het opzoeken of terwijl een upload nog onderweg is, een herlaad nadat het
  opzoeken tijdens het spel klaar raakte, en een evenwichtige greep bij een vroege start. Een run laat hoogstens 51
  rijen achter in de gedeelde lijst.
- De regels voor het kiezen van een jaartal (dezelfde in de browser en in het Python-script), ook met een nagebootste
  MusicBrainz die pagina's en de filters op eerste release en studio-uitgave nadoet.
- Installeren als app: het manifest, de iconen (bestaan, PNG, juiste afmetingen), de meta's voor iOS, en dat Chromium
  de site installeerbaar vindt. De iconen maak je opnieuw met `node tools/iconen.mjs`.
- Beide servervarianten (Node en Cloudflare, lokaal), en met `npm run test:live` de uitgerolde site en server.

Niet gedekt, alleen in het echt te testen:

- Inloggen bij de echte Spotify en het echte afspelen op een toestel; hoe snel een echte box of tv na een
  startcommando overschakelt en wat ze dan meldt (de controle wacht tot ongeveer 5 s per poging).
- De echte Spotify-speler in de browser (*Dit toestel*), zeker op een gsm.
- Slepen op een echte gsm: de tests slepen met een nagebootste muis en vinger in Chromium. Hoe het aanvoelt (vlot,
  of het scrollen ernaast goed blijft werken) en het gedrag van Safari op iPhone zijn alleen in het echt te zien.
- Het gedrag van de Spotify-app op jouw gsm (melding, vergrendelscherm) en van je box.
- De app echt installeren op Android en iPhone, en inloggen bij Spotify vanuit de geïnstalleerde app.
