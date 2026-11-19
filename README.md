# Muziek-tijdlijn

Muziekspel voor een groep vrienden: er speelt een nummer, niemand ziet titel of artiest, en wie aan de beurt is legt het op
de juiste plaats op zijn tijdlijn. Iedereen speelt op zijn eigen gsm in de browser; de muziek komt uit één box, via de
Spotify van de host, of zonder enig account met fragmenten van 30 seconden van Deezer. Met fragmenten kan je ook op
afstand spelen: wie wil, laat het fragment dan ook op zijn eigen gsm spelen.

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
- De host kiest de nummers: met Spotify de standaardlijst van het spel of een van zijn eigen Spotify-playlists; met
  fragmenten een van de lijsten van het spel (zie *Spelen met fragmenten*).
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
  stapel zitten) en rechts het menu (spelcode, spelregels, het spel verlaten, bij fragmenten voor de andere spelers
  *Geluid op dit toestel*, en voor de host de muziek, *Ander
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
  verplaatst ze, terug naar de houder slepen (die verschijnt dan weer in de balk) maakt de keuze ongedaan, en
  *Leg het …* in de balk bevestigt. Sleep je tot bij de boven- of onderrand, dan schuift de tijdlijn mee; bij veel
  kaarten worden ze compacter. Zonder slepen
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
   ├── Spotify Web API ──> Spotify-toestel van de host ──> box
   └── of: Deezer-API (adres van het fragment) ──> <audio> in de browser van de host ──> box
              └── adres ──> spelserver ──> alleen gsm's met «Geluid op dit toestel» ──> <audio> op die gsm
```

| Map | Wat |
| --- | --- |
| `web/` | De site (Vite + Preact). Staat op GitHub Pages. |
| `server/src/` | De spelregels, los van hoe de server draait. |
| `server/cloudflare/` | De server als Cloudflare Worker met een Durable Object per spel. |
| `server/node/` | Dezelfde server als gewoon Node-programma (eigen server, lokaal testen). |
| `tools/` | Het Python-script dat `tracks.json` maakt, met cache en correcties, en `deezer.py` voor de fragmenten. |
| `tests/` | Unit-tests en het spelverloop met meerdere browsers (Playwright). |

- **De server is de baas.** De gsm's sturen alleen acties («ik leg het hier») en krijgen bij elke wijziging de volledige
  stand terug. Valt een verbinding weg (scherm vergrendeld, wifi kwijt), dan herverbindt de gsm vanzelf en klopt alles
  meteen weer. Je plaats in het spel zit in een token in de browser, dus ook herladen kan.
- **Het antwoord lekt niet.** Titel, artiest, jaar en track-ID van het lopende nummer gaan pas bij de onthulling naar de
  spelers. Alleen de gsm van de host krijgt het track-ID eerder, omdat die Spotify moet aansturen. Voor de host is het
  dus te vinden voor wie echt wil zoeken; dat kan niet anders zolang zijn gsm de muziek start. Met fragmenten is dat
  net zo: zie *Fragmenten van Deezer* hieronder.
- **Acties.** Een gsm stuurt `{ t: 'hello', token }` om zich aan te melden en daarna een van deze acties: `start`,
  `settings`, `clearDeck`, `select`, `place`, `challenge` (met `index`: een token inzetten), `pass` (deze beurt geen
  token inzetten), `reveal` (einde van het inzetten, pas als iedereen koos; de host kan met `force: true` toch
  onthullen), `buy` (op je eigen beurt de kaart kopen voor 3 tokens), `next`, `token` (met `playerId` van wie het token van deze beurt krijgt; leeg neemt het terug),
  `skipTrack`, `skipTurn`, `remove` en `lobby`. De server antwoordt met `{ t: 'state' }` of
  `{ t: 'error', code, message }`. Zie `server/src/room.js`.
- **Geluid op afstand (alleen met fragmenten).** De host stuurt `sound` (`{ action: 'play' | 'url' | 'pause' |
  'resume', trackId, url? }`); een andere speler stuurt `listen` (`{ on: true | false }`, per verbinding) en
  `soundFail` (`{ n }`: het adres speelt hier niet). Wie `listen` aan heeft, krijgt naast de stand een apart bericht
  `{ t: 'sound', sound: { n, url, playing, pos } | null }`. Zie *Spelen op afstand* hieronder en `server/src/sound.js`.
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
- **Fragmenten van Deezer.** De tweede muziekbron, zonder login, toestel of Premium (`web/src/fragment/`,
  `web/src/lib/fragments.js`):
  - Een fragment heeft als track-ID `dz-` en het Deezer-ID (`dz-3135556`). Dat past in de bestaande controle van de
    server (`TRACK_ID` in `server/src/tracks.js`: letters, cijfers, `_` en `-`), dus de stapel, de beurten, *Ander
    nummer* en "geen nummers herhalen" werken ongewijzigd, in beide servervarianten. Een Spotify-ID heeft nooit een
    streepje, dus de twee lopen nooit door elkaar. De server kijkt alleen na dat er na `dz-` cijfers staan, en noemt
    een lijst met alleen fragmenten in de stand `source: 'fragment'` (zodat de wachtkamer weet dat ze bij fragmenten
    past). Verder weet de server niets van Deezer.
  - Kiest de host een lijst, dan haalt zijn browser `fragmenten.json` van de site, neemt de nummers van die lijst
    (meer dan 500: een willekeurige greep van 500, zoals bij een grote playlist) en stuurt ze met de bestaande route
    `POST /api/rooms/:code/deck` naar de server, net als een eigen playlist. De lijst blijft op de server; de andere
    spelers zien alleen de naam en het aantal.
  - Elke beurt krijgt de gsm van de host, zoals bij Spotify, alleen het ID van het nummer. Vlak voor het afspelen
    vraagt zijn browser `https://api.deezer.com/track/<id>` op, met JSONP (een `<script>`; de API stuurt geen
    CORS-kop). Het adres van de mp3 (`cdnt-preview.dzcdn.net`) draagt een handtekening die na enkele uren verloopt,
    dus het wordt nooit vooraf bewaard. Eén `<audio>`-element speelt het fragment, herhalend (`loop`) tot er iets
    anders moet spelen, ook tijdens de onthulling, zoals Spotify. Speelt het adres niet, dan vraagt het spel één keer
    een nieuw (verlopen handtekening); lukt dat ook niet, of bestaat het nummer niet (meer), dan krijgt de host een
    melding met *Ander nummer*. Eén verzoek naar Deezer per beurt (Deezer laat er 50 per 5 seconden toe), plus één per
    *Opnieuw afspelen*.
  - Een browser speelt geen geluid zonder aanraking: de host tikt één keer op *Zet het geluid aan*. Na een herlaad
    (of als de browser het geluid toch weigert) verschijnt die knop op het spelscherm en begint het fragment van de
    beurt opnieuw.
  - Het ophalen en afspelen (`web/src/fragment/`) weet niet wie host is: de gsm van een speler die meeluistert,
    gebruikt dezelfde speler.
- **Spelen op afstand: geluid op de gsm van een speler.** Alleen als de host met fragmenten speelt; met Spotify blijft
  het geluid bij de host (`web/src/lib/listen.js`, `server/src/sound.js`):
  - **Hoe het adres bij de spelers komt.** De browser van de host vraagt het adres van de mp3 op bij Deezer (dat
    deed hij al om zelf af te spelen) en stuurt het met `{ t: 'sound', action: 'play', trackId, url }` naar de
    server. De server aanvaardt dat alleen van de host van het spel en alleen voor het nummer van de lopende beurt
    (een bericht voor een vorig of verzonnen nummer doet niets), en kijkt het adres streng na: letterlijk
    `https://`, alleen `cdnt-preview.dzcdn.net` of `cdns-preview-<x>.dzcdn.net`, geen poort, gebruikersnaam of `#`,
    geen spaties, aanhalingstekens of stuurtekens, hoogstens 600 tekens. Een ander nummer, een volgende beurt of
    het einde van het spel maakt het ongeldig. De browser van een speler spreekt de API van Deezer dus nooit aan
    (die zou het ID nodig hebben); hij krijgt alleen het adres en speelt dat.
  - **Wie het krijgt.** Alleen een verbinding van een speler die geen host is en `{ t: 'listen', on: true }` stuurde,
    krijgt het, in een apart bericht `{ t: 'sound', sound: { n, url, playing, pos } }`: `n` telt de starts (een
    nieuwe start = van voren), `playing` of het speelt, `pos` waar het staat. Geen track-ID, titel, artiest of jaar,
    en nooit in de gewone stand. De keuze geldt per verbinding; de gsm stuurt ze bij elke nieuwe verbinding opnieuw
    (op Cloudflare blijft ze bij de verbinding bewaard, ook als de kamer slaapt). De host ziet in zijn stand alleen
    `sound: { n, playing, stale, r }`, zonder adres.
  - **Gelijk lopen.** De server houdt met zijn eigen klok bij wanneer het fragment begon, en bij pauze waar het
    stond. In elk bericht staat `pos`: de plaats op het moment dat de server het bericht maakt. De gsm telt daar de
    tijd sinds ontvangst bij (met `performance.now()`, de klok van de gsm zelf, die alleen vooruit loopt) en de
    halve duur van de kortste recente ping naar de server. Zo worden nooit de klokken van twee toestellen met
    elkaar vergeleken. Herhalen gaat modulo de echte duur van het fragment (30 s zolang die niet gekend is), net
    als bij de host. Bij elk bericht en om de 5 s kijkt de gsm na of hij nog gelijk loopt, en springt hij bij als
    het meer dan 0,35 s verschilt. Wie later aanhaakt of herlaadt, valt zo in op de juiste plaats. Pauze, *Opnieuw
    afspelen*, *Ander nummer* en een nieuwe beurt volgen vanzelf; tijdens de onthulling blijft het spelen, zoals bij
    de host.
  - **Fouten.** Speelt het adres niet op een gsm, dan ziet alleen die speler één regel met *Probeer opnieuw*.
    Misschien is het adres verlopen: de gsm meldt dat (`soundFail`), de host ziet `stale`, vraagt een vers adres bij
    Deezer en stuurt het met `action: 'url'` (de plaats blijft); de gsm probeert dan vanzelf opnieuw. Dat kan
    hoogstens 3 keer per start, zodat een gsm zonder netwerk de host geen reeks verzoeken bij Deezer laat doen.
    Weigert de browser het geluid, of na een herlaad, dan staat er *Zet het geluid aan*. Bestaat het fragment niet,
    dan stuurt de host niets en beslist hij zoals altijd (*Ander nummer*).
  - **De host zonder geluid.** Ook als de host zelf geen geluid maakt, krijgen de spelers het adres: na een herlaad
    (voor hij *Zet het geluid aan* tikt; heeft de server al een adres voor deze beurt, dan stuurt hij niets, zodat
    het bij de spelers niet opnieuw begint) en als hij koos voor *Geen geluid op dit toestel* (bv. in een stille
    ruimte). Die keuze blijft bewaard op zijn gsm voor dit spel; hij kan dan starten zonder geluid, en bedient
    pauze, opnieuw en ander nummer zoals altijd. Hoort dan niemand iets, dan zet niemand *Geluid op dit toestel*
    aan.
  - Een verzoek naar Deezer per beurt, zoals voordien (ook zonder geluid bij de host), plus hoogstens 3 voor een vers
    adres als een speler erom vraagt.
- **Wat de browsers zien.**
  - Een gast krijgt van de server tot de onthulling niets van het lopende nummer: geen ID (ook geen Deezer-ID),
    titel, artiest of jaar, bij Spotify en bij fragmenten. Zijn browser spreekt Deezer en Spotify niet aan en haalt
    geen lijst met nummers op.
  - Een gast met *Geluid op dit toestel* krijgt daarbovenop alleen het bericht `{ t: 'sound', sound: { n, url,
    playing, pos } }`, met het adres van de mp3 (`https://cdnt-preview.dzcdn.net/api/1/1/…/<hash>.mp3?hdnea=…`), en
    zijn browser haalt dat mp3-bestand op bij `cdnt-preview.dzcdn.net`. Het adres van de mp3 bevat bij het echte
    Deezer een hash en een handtekening, niet het ID of de titel (zoals we het kennen; zie *Niet gedekt*). Zijn
    browser spreekt `api.deezer.com` niet aan. Een gast met geluid uit krijgt geen enkel geluidsbericht en geen
    adres.
  - De host ziet op zijn scherm tot de onthulling geen titel, artiest of jaar. Zijn browser krijgt wel het ID van het
    lopende nummer. Met Spotify vraagt zijn browser daarmee bij Spotify wat er speelt (met titel en artiest in het
    antwoord); met fragmenten vraagt hij het adres bij Deezer, en ook dat antwoord bevat titel, artiest, album en
    datum (het spel gooit alles behalve het adres meteen weg). Wie de ontwikkelaarstools opent, vindt het dus, net
    als bij Spotify. Het adres van de mp3 zelf bevat geen titel. De mediabediening van de gsm (meldingen,
    vergrendelscherm) krijgt alleen «Muziek-tijdlijn». Bij fragmenten haalt de browser van de host ook
    `fragmenten.json` op, met alle nummers van alle lijsten (niet welk nummer nu speelt); bij Spotify haalt hij voor
    de geluidstest en een eigen playlist net zo de standaardlijst `tracks.json` op.
- **Eigen playlist.** Kiest de host een eigen playlist, dan leest zijn browser de nummers bij Spotify, zoekt de
  jaartallen op bij MusicBrainz en Wikidata en stuurt de lijst naar de server. Die lijst blijft op de server; de
  andere spelers zien alleen de naam en het aantal nummers.
- **Gedeelde jaartallen.** Wat een host opzocht, bewaart de server in één gedeelde lijst voor alle spellen: per
  Spotify-track-ID het jaar, de bron (`musicbrainz`, `spotify`, `wikidata`, `onbekend` of `handmatig`), eventuele
  twijfels, de regelversie (`r`), wat elke bron zei (`b`: `{ sp, mb, wd }`, het jaar van het Spotify-album, van
  MusicBrainz en van Wikidata), de titel en de artiest zoals Spotify ze geeft (elk hoogstens 120 tekens platte
  tekst), en wanneer het item het laatst veranderde. Geen namen van spelers of hosts, geen persoonsgegevens. Alleen
  de host van een bestaand spel kan erin lezen of schrijven (met de geheime sleutel van zijn plaats in dat spel);
  gasten niet, want de lijst verklapt antwoorden. Een handmatige verbetering gaat voor op een opgezocht jaar en wordt
  daar nooit door overschreven; een nieuwere verbetering vervangt een oudere; een resultaat van oudere regels
  (lagere `r`) vervangt nooit een nieuwer. Stuurt een oudere site een item zonder titel, artiest of `b`, dan blijven
  die staan. Op Cloudflare staat de lijst in een tweede Durable Object (`YearStore`, één exemplaar, SQLite; de
  kolommen `b`, `title` en `artist` komen er bij de eerste start vanzelf bij); de Node-server houdt ze in het
  geheugen en in `DATA_FILE` als dat ingesteld is.
- **Routes.** `POST /api/rooms` (spel maken), `POST /api/rooms/:code/join`, `POST /api/rooms/:code/deck` (eigen
  lijst van de host), de WebSocket `/api/rooms/:code/ws`, en voor de gedeelde jaartallen (alleen de host):
  - `POST /api/rooms/:code/years/lookup` met `{ token, ids }` (hoogstens 500 track-ID's). Antwoord
    `{ years: { id: { y, s, d, r?, b?, named? } }, names: true }` met alleen wat gekend is; `named` zegt of titel en
    artiest er al zijn, `names` dat de server ze bewaart.
  - `POST /api/rooms/:code/years` met `{ token, entries }` (hoogstens 500). Een item is `{ id, y, s, d, r, b, title,
    artist }`, of alleen `{ id, title, artist }` om titel en artiest aan te vullen van een nummer dat er al staat
    (jaar en bron blijven dan wat ze waren; wat er al staat, wordt niet overschreven). Antwoord
    `{ ok, saved, skipped }`. Ongeldige items worden overgeslagen.
  - `POST /api/rooms/:code/years/export` met `{ token, after?, limit? }`: de hele lijst in pagina's, op track-ID.
    `after` is het laatste ID van de vorige pagina (leeg of weg voor de eerste), `limit` 1 tot 500 (standaard 500).
    Antwoord `{ entries: [{ id, y, s, d, r?, b?, title?, artist?, at }], next }`: `at` is het tijdstip van de
    laatste wijziging in ms (null voor items van vóór die kolom), `next` het `after` voor de volgende pagina, of
    `null` als dit de laatste is. Een pagina leest hoogstens `limit + 1` rijen.

  Een gast krijgt `400 HOST_ONLY`, een onbestaand spel `404 NO_ROOM`, de sleutel van een ander spel `400 BAD_TOKEN`.
  Zie `server/src/yearlist.js`.

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

Zonder Spotify (geen account, geen Premium): zie *Spelen met fragmenten*. Met Spotify:

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

### Spelen met fragmenten (zonder account)

Iedereen kan zo host zijn: er is geen login, geen toestelkeuze en geen Premium nodig. Elke beurt speelt een fragment
van 30 seconden van Deezer, steeds opnieuw tot de beurt voorbij is. Het geluid komt uit de gsm (of laptop) van de host;
hang die aan een box als je wil. Op afstand spelen kan ook: zie hieronder.

1. **Host:** open de site en kies *Nieuw spel*.
2. **Host:** kies onder *Muziek* de bron *Fragmenten (30 seconden, zonder account)* en tik op *Zet het geluid aan*
   (een browser speelt pas geluid na een tik).
3. **Host:** kies onder *Nummers* een van de lijsten van het spel. Bij elke lijst staat hoeveel nummers ze heeft; een
   lege lijst staat er niet bij. Heeft een lijst meer dan 500 nummers, dan kiest het spel er willekeurig 500 uit
   (kies ze later opnieuw voor een andere greep). Daarna gaat het zoals altijd: spelers komen binnen, de host start.

*Opnieuw afspelen*, *Pauze* en *Ander nummer* werken zoals bij Spotify. Herlaadt de host de pagina, of weigert de
browser het geluid, dan staat op het spelscherm *Zet het geluid aan*: één tik en het fragment van de beurt begint
opnieuw. Bestaat een fragment niet (meer), dan zegt het spelscherm dat, met de knop *Ander nummer*. Na de onthulling
staat er *Open in Deezer* (bij Spotify *Open in Spotify*).

De keuze van de bron blijft bewaard op de gsm van de host. Wissel je terug naar Spotify, dan speelt het spel weer met
de standaardlijst (een fragmentenlijst kan Spotify niet spelen, en omgekeerd).

**Op afstand spelen.** Zit niet iedereen bij dezelfde box, dan zet elke speler die ver weg zit *Geluid op dit toestel*
aan: in de wachtkamer of in het menu (onder *Voor iedereen*). Dan speelt het fragment van de beurt ook op zijn gsm,
ongeveer gelijk met de host, en het volgt pauze, *Opnieuw afspelen* en *Ander nummer*. Zit je wel bij de box van de
host, laat het dan uit: anders hoor je het dubbel. De keuze staat standaard uit en blijft bewaard op je gsm voor dit
spel. Na een herlaad (of als de browser het geluid weigert) staat op je spelscherm *Zet het geluid aan*; speelt het
fragment bij jou niet, dan zie alleen jij dat, met *Probeer opnieuw*. Met Spotify is de keuze er niet: dan blijft het
geluid bij de host.

Wil de host zelf geen geluid (hij zit bv. in een stille ruimte, of alle spelers zitten elders), dan tikt hij bij
*Muziek* op *Geen geluid op dit toestel*. Het spel werkt dan gewoon, en de spelers met *Geluid op dit toestel* horen
het fragment; de host bedient het zoals altijd. *Zet het geluid hier toch aan* maakt dat ongedaan.

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
zelf maakte of waaraan hij meewerkt. Het spel zoekt dan per nummer het jaar van de eerste release op bij MusicBrainz,
met Wikidata als derde bron (zie *Hoe het jaar gekozen wordt*).

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
  eerste keer op ongeveer 2 seconden per nummer, 500 nieuwe nummers duren zo'n kwartier. Wikidata loopt daarnaast,
  met één verzoek per 25 titels (20 verzoeken voor 500 nummers), en maakt het niet trager. Alles
  wat opgezocht is, onthoudt de browser van de host en gaat ook naar de gedeelde lijst op de server. Een tweede keer
  gaat het meteen, ook op een ander toestel, in een andere browser of bij een andere host. Op de server staan
  track-ID, jaar, bron, twijfels, wat elke bron zei, titel en artiest; alleen een host van een lopend spel kan ze
  lezen of aanvullen. Titel en artiest van nummers die al in de gedeelde lijst stonden zonder, vult de app
  op de achtergrond aan.
- Is de server even niet bereikbaar of kent hij de gedeelde lijst nog niet, dan gaat alles zoals voordien, met wat
  de browser onthield en MusicBrainz. Is Wikidata niet bereikbaar of te druk, dan beslissen Spotify en MusicBrainz
  zoals vroeger.
- Jaartallen die met oudere regels gekozen zijn en een twijfel hadden, worden bij de volgende keuze van de playlist
  opnieuw beoordeeld: eerst met wat MusicBrainz toen zei en Wikidata (geen nieuw verzoek naar MusicBrainz als dat
  volstaat), anders helemaal opnieuw. Wat geen twijfel had, blijft; een handmatige verbetering blijft altijd.
- Nummers uit de standaardlijst van het spel zijn al nagekeken en worden niet opnieuw opgezocht.
- Een remix krijgt het jaar van de remix, niet dat van het origineel: de spelers horen de remix. Dat zie je aan de
  titel ("- X Remix", "(X Remix)", ook "Rework", "Bootleg", "Mashup" en "Refix"). "Radio Edit", "Extended Mix" of
  "Remastered" tellen als het origineel. Kent MusicBrainz de remix niet, dan geldt het jaar van het Spotify-album.
- Het spel toont de jaartallen waar de bronnen het oneens blijven, met kort wat elke bron zegt ("Spotify 2009 ·
  MusicBrainz 2000 · Wikidata –"), ook al terwijl de rest nog opgezocht wordt. De host kan ze daar verbeteren;
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
- Met fragmenten: het spel toont geen titel, en de mediabediening van de gsm (melding, vergrendelscherm) toont alleen
  «Muziek-tijdlijn». Open tijdens een beurt geen ontwikkelaarstools: het antwoord van Deezer bevat de titel.

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
| Fragmenten: geen geluid | Tik op *Zet het geluid aan* (na een herlaad altijd nodig). Staat het volume van de gsm open? |
| Fragmenten: «bestaat niet (meer)» | Deezer heeft dat fragment niet (meer). Tik op *Ander nummer*. |
| Fragmenten: «Deezer antwoordt niet» | Geen internet, of Deezer is even weg. *Opnieuw afspelen*, of *Ander nummer*. |
| Op afstand: geen geluid op mijn gsm | Staat *Geluid op dit toestel* aan (menu)? Na een herlaad: *Zet het geluid aan* op het spelscherm. Staat het volume open? |
| Op afstand: «speelt niet op dit toestel» | Controleer je verbinding en tik op *Probeer opnieuw*. De anderen spelen gewoon verder. |
| Op afstand: dubbel geluid | Wie bij de box van de host zit, zet *Geluid op dit toestel* uit. |

## Nummers en jaartallen bijwerken

Dit gaat over de standaardlijst van het spel, de lijst waarmee iedereen kan spelen zonder iets te kiezen. Voor een
eigen playlist is het script niet nodig: zie *Spelen met een eigen playlist*.

`web/public/tracks.json` bevat per nummer: Spotify track-ID, artiest, titel, jaar en de bron van dat jaar
(`musicbrainz`, `spotify`, `wikidata` of `handmatig`). Het script `tools/tracks.py` maakt dat bestand.

### Hoe het jaar gekozen wordt

In de browser van de host en in het script hetzelfde (`web/src/lib/years.js`, `web/src/lib/wikidata.js`,
`tools/tracks.py`). Drie bronnen:

- **Spotify** geeft alleen de datum van het album, en dat is vaak een remaster of compilatie.
- **MusicBrainz** (vrijwilligers, vrije gegevens): het jaar van de eerste release. Alleen officiële studio-uitgaven
  tellen: bootlegs, promo's, live-albums en demo's zijn er vaak fout of veel te vroeg gedateerd. Een remix-, live-,
  instrumentale, karaoke- of demo-opname telt niet voor het gewone nummer. Alle opnames van een nummer samen: een
  jaar met alleen verzamelaars telt pas vanaf twee verschillende verzamelaars, want een enkele verzamelaar is vaak
  fout gedateerd (Radar Love op "The Best of Golden Earring, 1971", terwijl de single van 1973 is).
- **Wikidata** (vrije gegevens, CC0, zonder account): de publicatiedatum van het nummer of de single, gezocht op
  titel en uitvoerder (albums, video's en covers van anderen tellen niet). Eén verzoek naar `query.wikidata.org`
  zoekt 25 titels tegelijk. Een lied-item draagt vaak de datum van de single, soms een jaar na het album.

De regel: twee bronnen die het eens zijn (hoogstens een jaar verschil), winnen van de derde. MusicBrainz en Spotify
eens: het vroegste van de twee (een album kan niet voor de eerste release liggen). Oneens: Wikidata beslist als het
bij precies een van de twee past. Ligt Wikidata nog vroeger dan beide, dan Wikidata, met twijfel. Zonder beslissing
geldt MusicBrainz als het meerdere uitgaven in zijn jaar heeft en vóór Spotify ligt (een remaster of verzamelaar);
anders het vroegste, met twijfel. Een losse vroegste uitgave bij MusicBrainz met kort daarna veel meer, telt niet
als Wikidata dat latere jaar zegt (een album "van 2003" dat in 2004 uitkwam); een echte vroege single heeft in
Wikidata haar eigen datum. Dat geldt alleen als Spotify later zegt dan die vroege uitgave: zegt Spotify precies dat
vroege jaar, dan bevestigt het album haar en is de datum van Wikidata die van een latere single (Clouseau, "Daar
gaat ze": album 1989, single 1990). Kent MusicBrainz een vroeger jaar met maar één verzamelaar en zegt Wikidata
precies dat jaar, dan telt die vroege uitgave (Fall Out Boy, "Centuries": single 2014, album 2015). Zegt Spotify
precies het vroegste jaar dat MusicBrainz kent, dan telt dat (een nieuw nummer op een eigen best-of), tenzij
Wikidata het latere jaar van MusicBrainz zegt. Een remix krijgt het jaar van die
remix zelf; vindt MusicBrainz ze niet, dan het jaar van het Spotify-album (en nooit dat van het origineel). Bij remixes,
live-opnames en heropnames ("Taylor's Version") telt Wikidata niet mee: het beschrijft het origineel. "Edit", "Mix" en
"Remastered" zonder het woord "remix" tellen als het origineel. Alleen als er geen overeenstemming is, komt het nummer op de lijst om na te kijken.

De browser van de host spreekt daarvoor `musicbrainz.org` en `query.wikidata.org` aan (beide laten dat toe vanuit
een webpagina), met de gewone User-Agent van de browser. De titels en artiesten gaan dus naar die twee diensten;
verder niets.

Zo zoekt het (in het script en in de browser hetzelfde): eerst op titel en artiest. Passen alle opnames op één pagina
(hoogstens 100), dan is dat genoeg: 1 verzoek. Bekende nummers hebben honderden opnames; dan volgt één gericht verzoek
naar de opnames die vóór het gevonden jaar voor het eerst uitkwamen. Is die pagina volledig, dan bestaat er zeker
geen vroegere officiële uitgave: een officiële uitgave is nooit vroeger dan de eerste release van haar opname. Alleen
als de eerste pagina geen officiële studio-uitgave bevat, of als ook de oudere opnames niet op één pagina passen, komt
er een verzoek bij met alleen officiële studio-uitgaven. Gemiddeld kost een nummer zo anderhalf verzoek.

### Het script draaien

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
  `tools/musicbrainz-cache.json` en `tools/wikidata-cache.json`, dus een tweede keer gaat snel. Met `--opnieuw`
  zoekt het alles opnieuw op, met `--zonder-wikidata` vraagt het Wikidata niet.
- `tools/playlist.json` is de laatst opgehaalde lijst. Met `--invoer tools/playlist.json` draai je zonder Spotify-login.

**Nakijken.** `tools/tracks-nakijken.md` somt op wat je best controleert: nummers waar de bronnen het oneens blijven
(met wat Spotify, MusicBrainz en Wikidata zeggen), nummers die niemand vond, en dubbels. Onderaan staat de volledige lijst op
jaar, om snel te overlopen. MusicBrainz is door vrijwilligers ingevuld en niet foutloos.

**Verbeteren.** Zet het juiste jaar in `tools/correcties.json` en draai het script opnieuw:

```json
{
  "5IX4TbIR5mMHGE4wiWwKW0": { "year": 1989, "note": "single uit 1989" }
}
```

Commit daarna `web/public/tracks.json` en de bestanden in `tools/`. Na de push naar `main` staat de nieuwe lijst online;
de server haalt ze bij de start van elk spel opnieuw op.

## Lijsten met fragmenten bijwerken

Het bronbestand is `web/public/fragmenten.json`. Het staat op de site; alleen de browser van een host die met
fragmenten speelt, haalt het op. Eén nummer per regel:

```json
{
  "lists": [
    {"id": "alles", "name": "Alle hits"},
    {"id": "nl", "name": "Nederlandstalig"}
  ],
  "tracks": [
    {"deezer": 3135556, "artist": "Daft Punk", "title": "Harder, Better, Faster, Stronger", "year": 2001, "lists": ["alles"]}
  ]
}
```

- Een lijst toevoegen: een item in `lists` (de volgorde is die op het scherm) en het `id` bij de nummers die erin
  horen. Een lijst zonder nummers wordt niet getoond: zo staan *Nederlandstalig* (`nl`) en *Rustige pop en ballads*
  (`rustig`) er al klaar.
- Een nummer wijzigen of toevoegen: die ene regel. `deezer` is het ID uit het adres bij Deezer
  (`deezer.com/track/<ID>`), `year` het jaar dat bij de onthulling verschijnt. Elk nummer zit in minstens één lijst;
  een nummer met een ongeldig ID, jaar of lege titel of artiest, of een ID dat al voorkomt, doet niet mee. Een lijst
  heeft minstens 10 nummers nodig om mee te spelen.
- `npm test` kijkt het bestand na (geldige nummers, geen dubbels, de afgesproken lijsten, "2000 tot nu" klopt).

Nu (november 2026) staan er 758 nummers in: 616 uit de 644 nagekeken nummers van de eigenaar, en 142 die voor de
lijsten Nederlandstalig en Rustige pop en ballads met de hand zijn toegevoegd:

| Lijst | Nummers | Wat |
| --- | --- | --- |
| Alle hits | 758 | alles met een Deezer-ID (dubbels eruit) |
| 2000 tot nu | 384 | jaar 2000 of later |
| Pop | 341 | genre Pop, plus de toegevoegde nummers van Rustige pop en ballads |
| Rock | 272 | genres Rock, Alternative en Indie Rock, plus de 54 bekendste nummers met Metal of Hard Rock (hoogstens een vijfde) |
| Dance | 51 | genres Dance, Electro, Techno/House, Dancefloor of Disco |
| Nederlandstalig | 102 | met de hand samengesteld; jaartal vergeleken met MusicBrainz en Wikidata |
| Rustige pop en ballads | 104 | met de hand samengesteld (Adele, Lewis Capaldi en dergelijke); zelfde controle |

De genres zijn die van het album bij Deezer. Voor Rock telt een nummer met ook Metal of Hard Rock als metal; daarvan
gaan er zoveel mee als een vijfde van de lijst toelaat, de bekendste eerst (`rank` van Deezer, bij gelijke rank het
laagste ID). Dat ligt vast in het bronbestand, er is geen toeval bij het bouwen.

### Deezer-ID's zoeken

`tools/deezer.py` (Python 3.9 of nieuwer, geen extra pakketten) zoekt voor een lijst nummers het Deezer-ID van de
juiste opname:

```bash
python tools/deezer.py zoek nummers.json --uit gevonden.json
python tools/deezer.py lijsten gevonden.json
```

- `nummers.json` is een lijst met minstens `artist` en `title` per nummer (en `year` voor `lijsten`), of een
  tekstbestand met per regel `Artiest - Titel`. `gevonden.json` krijgt per nummer `deezer` (of `null`),
  `deezer_titel`, `deezer_artiest`, `rank`, `album` en `album_genres`. Wat het niet vond, schrijft het onderaan op het
  scherm.
- `lijsten` maakt daaruit `web/public/fragmenten.json` opnieuw, met de lijsten die uit jaar en genre volgen (zie
  `LIJSTEN` bovenaan het script). Als genre telt `genres` uit de invoer, anders `album_genres`. Wat je met de hand in
  `nl` of `rustig` zette, blijft staan. Het is eenmalig handig; daarna pas je het bronbestand ook gewoon zelf aan.
- Zo zoekt het: eerst op artiest en titel samen, dan op de titel alleen, daarna hetzelfde zonder leestekens ("Chop
  Suey!" → "Chop Suey"), en als laatste kans in de 100 bekendste nummers van de artiest (zo vindt het *NSYNC, dat de
  gewone zoekfunctie mist). De geavanceerde zoekvorm `artist:"…" track:"…"` geeft bij Deezer nu niets terug en
  gebruikt het dus niet. Van de resultaten telt alleen wat een fragment heeft, van de juiste artiest is en dezelfde
  titel heeft (zonder accenten, hoofdletters en leestekens). Een live-versie, remix, akoestische, instrumentale of
  karaokeversie, "Sped Up", "(2025 Version)" of een woord dat niet in de gevraagde titel staat ("Jacques Lu Cont's
  Thin White Duke Mix") valt af, tenzij de gevraagde titel er zelf om vraagt ("Pump It - Live 2022"). "Remaster",
  "Radio Edit", "Single Version" en "feat." tellen als het origineel; een "Mix" zonder meer is tweede keus. Van wat
  overblijft wint het bekendste (`rank`).
- Hoogstens 3 verzoeken per seconde (Deezer laat er 50 per 5 seconden toe), met een algemene User-Agent zonder naam of
  adres; bij "Quota limit exceeded" wacht het. De antwoorden staan in `tools/deezer-cache.json` (niet in de repo: een
  paar MB), dus een tweede keer gaat meteen; `--opnieuw` vraagt alles opnieuw.
- `tools/deezer-gevonden.json` is wat het vond voor de 644 nummers (november 2026): 628 gevonden (eerder 593 juist).
  Niet gevonden, meestal omdat Deezer alleen een live-versie of remix heeft, of het nummer niet: Brutus (All Along,
  Victoria, War: alleen live), KVSH – Tokyo Drift, Black Sabbath – Paranoid (alleen live; staat twee keer in de
  lijst), Bart Peeters – Brood voor Morgenvroeg, Krezip – I Would Stay (alleen live), Macklemore & Ryan Lewis – Can't
  Hold Us (Live From Spotify NYC), Eddy Wally – Ik Spring Uit Een Vliegmachien, Niels Destadsbader – Verover Mij (Uit
  Liefde Voor Muziek), Miley Cyrus – Party In The U.S.A. (alleen live), Adele – Make You Feel My Love (alleen live),
  George Michael & Elton John – Don't Let the Sun Go Down on Me (Live), The Underdog Project – Summer Jam 2003
  (Remix), Bart Kaell – Zeil Je Voor Het Eerst (alleen een remix) en Jaap Reesema & Pommelien Thijs – Nu Wij Niet
  Meer Praten (alleen een remix).

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
geluid, maar het hele spel werkt (`?mock=0` zet het weer uit). Fragmenten zijn niet nagebootst: die spreken ook met
`?mock=1` het echte Deezer aan.

| Commando | Wat |
| --- | --- |
| `npm test` | Unit-tests van de spelregels. |
| `npm run test:py` | Unit-tests van de scripts voor de jaartallen en de Deezer-ID's (zonder netwerk). |
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
- Wikidata als derde bron, tegen een nagebootste Wikidata (`tests/e2e/wikidata.spec.js`): overeenstemming zonder
  twijfel, onenigheid die Wikidata beslist, geen Wikidata-resultaat, Wikidata onbereikbaar of te druk (alles zoals
  met twee bronnen), oude jaartallen met twijfel die opnieuw beoordeeld worden (zonder nieuw verzoek naar
  MusicBrainz waar dat kan), een handmatige verbetering die blijft, titel en artiest aanvullen, en de export voor de
  host (in pagina's; gasten en onbestaande spellen geweigerd). Het echte MusicBrainz en Wikidata worden in geen enkele
  test aangesproken, ook niet met `npm run test:live`. Een run laat 16 rijen achter in de gedeelde lijst.
- De regels voor het kiezen van een jaartal (dezelfde in de browser en in het Python-script), ook met een nagebootste
  MusicBrainz die pagina's en de filters op eerste release en studio-uitgave nadoet, en met echte gevallen waar
  MusicBrainz te vroeg zat (fout gedateerde verzamelaars, een remix die als origineel telde, een losse fout
  gedateerde uitgave) en de beslisregel met drie bronnen.
- Installeren als app: het manifest, de iconen (bestaan, PNG, juiste afmetingen), de meta's voor iOS, en dat Chromium
  de site installeerbaar vindt. De iconen maak je opnieuw met `node tools/iconen.mjs`.
- Fragmenten, tegen een nagebootste Deezer (`tests/e2e/fake-deezer.js`: de API met JSONP en een mp3 van 1,5 s), met
  een vaste testlijst in plaats van `fragmenten.json` (`tests/fixtures/fragmenten.json`) (`tests/e2e/fragments.spec.js`):
  een host zonder Spotify kiest de bron, zet het geluid aan en kiest een lijst (met aantallen, zonder de lege), het
  fragment van de beurt speelt en herhaalt, pauze en verder, opnieuw afspelen (met een vers adres), ander nummer, de
  onthulling met *Open in Deezer*, een volgende beurt; een fragment dat niet bestaat of geen adres heeft (melding met
  *Ander nummer*), een verlopen adres (403, het spel vraagt zelf een nieuw), geluid dat de browser weigert en een
  herlaad (*Zet het geluid aan* op het spelscherm), en wisselen tussen Spotify en fragmenten. En dat een gast tot de
  onthulling geen ID, Deezer-ID, titel, artiest of jaar van het lopende (of overgeslagen) nummer krijgt en zelf Deezer
  niet aanspreekt en geen lijst ophaalt, en dat de host Spotify niet aanspreekt. Het echte Deezer (`deezer.com`,
  `dzcdn.net`) is in alle tests geblokkeerd, ook met `npm run test:live`. De nagebootste Deezer geeft, zoals de
  echte, mp3-adressen met een hash in plaats van het ID.
- Spelen op afstand (`tests/e2e/listen.spec.js`, drie gsm's): een gast zet *Geluid op dit toestel* aan en hoort het
  fragment van de host (in zijn eigen nagebootste Deezer te zien), gelijk met de host (binnen 0,45 s); hij volgt
  pauze, verder spelen, opnieuw afspelen, ander nummer, de onthulling en de volgende beurt, en haakt na een herlaad
  met één tik weer aan op de juiste plaats; uitzetten stopt het en er komen geen adressen meer. Zijn browser spreekt
  de API van Deezer nooit aan; een gast met geluid uit krijgt geen geluidsbericht en geen adres; geen enkele gast
  krijgt titel, artiest, jaar of ID's voor de onthulling. Een host zonder geluid (*Geen geluid op dit toestel*, ook
  na een herlaad, zonder dat het bij de gast opnieuw begint). Fouten bij één gast: een verlopen adres (de host
  vraagt vanzelf een vers), geen netwerk (melding en *Probeer opnieuw* alleen bij die gast, hoogstens 3 verse
  adressen per start), geluid dat de browser weigert. En dat de keuze er met Spotify niet is. Unit-tests
  (`tests/unit/sound.test.js`): de controle van het adres, dat alleen de host het kan doorgeven en alleen voor de
  lopende beurt, wie het krijgt, de plaats bij pauze, verder en later aanhaken, dat het vervalt bij een ander
  nummer, en het rekenen op de gsm (verstreken tijd, herhalen, wanneer bijspringen). Unit-tests: het bronbestand en de lijsten,
  het opvragen van een adres, de speler (ontgrendelen, herhalen, geweigerd, verlopen, een nieuwere start wint) en hoe
  de server een fragmentenlijst herkent; `tools/test_deezer.py` voor het zoeken en het maken van de lijsten.
- Beide servervarianten (Node en Cloudflare, lokaal), en met `npm run test:live` de uitgerolde site en server.

Niet gedekt, alleen in het echt te testen:

- Inloggen bij de echte Spotify en het echte afspelen op een toestel; hoe snel een echte box of tv na een
  startcommando overschakelt en wat ze dan meldt (de controle wacht tot ongeveer 5 s per poging).
- De echte Spotify-speler in de browser (*Dit toestel*), zeker op een gsm.
- Slepen op een echte gsm: de tests slepen met een nagebootste muis en vinger in Chromium. Hoe het aanvoelt (vlot,
  of het scrollen ernaast goed blijft werken) en het gedrag van Safari op iPhone zijn alleen in het echt te zien.
- Het gedrag van de Spotify-app op jouw gsm (melding, vergrendelscherm) en van je box.
- De app echt installeren op Android en iPhone, en inloggen bij Spotify vanuit de geïnstalleerde app.
- Fragmenten echt afspelen: getest is alleen tegen een nagebootste Deezer, in Chromium. Of de echte mp3's van
  `cdnt-preview.dzcdn.net` in een browser spelen (dat adres was bij het bouwen niet bereikbaar), hoe Safari op iPhone
  en Chrome op Android met het ontgrendelen, het herhalen en een vergrendeld scherm omgaan, en wat de mediabediening
  van een echte gsm toont, is alleen in het echt te zien.
- Spelen op afstand in het echt: getest is met Chromium op één machine, tegen een nagebootste Deezer en een mp3 van
  1,5 s. Of het echte geluid op echte gsm's (Safari op iPhone, Chrome op Android, ook met vergrendeld scherm of de
  site op de achtergrond) speelt, hoe gelijk het loopt over echte netwerken met wisselende vertraging (gerekend is
  met een halve ping; enkele tienden van een seconde verschil zijn verwacht), en of het echte adres van Deezer echt
  geen ID bevat en op een andere gsm (ander IP-adres) speelt, is niet nagekeken.
- De voorwaarden van Deezer voor het gebruik van de API en de fragmenten in een spel zijn niet nagekeken.
