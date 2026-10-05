# QC Rondgang

Webapp voor de dagelijkse kwaliteitsrondgang op een Android-tablet. Werkt zonder verbinding en verzendt zelf zodra er verbinding is. Het volledige ontwerp staat in `bouwplan-qc-rondgang.md`, één map hoger. Dat document bevat spreadsheet-ID's en hoort niet in de publieke repository.

Gebouwd zijn fase 1 tot 3: de productiecontroles (Boven en Beneden, elk op één scherm), de twee foto's per controle, en de dagcontroles "Werkmaterialen boven" en "Magazijn en bufferzone". Fase 4, de overstap naar de echte sheet, is niet begonnen: alles hieronder gebeurt op de testkopie.

Versies in deze map: script 2.3.0 (`apps-script/Code.gs`), app 1.6.0 (`docs/js/versie.js`).

Kolomletters in dit document zijn die van de testkopie op 5 oktober 2026, na het toevoegen van "THT ZK" (L) en "THT GRD" (AQ). Het script zoekt elke kolom op haar naam in rij 2, niet op haar letter: een kolom toevoegen of verplaatsen breekt niets, een kolom hernoemen wel.

## Wat staat waar

| Map | Inhoud |
|---|---|
| `docs/` | De app zelf. Dit is wat GitHub Pages serveert. |
| `apps-script/Code.gs` | Het script dat aan de sheet hangt. |
| `test/` | Tests: het echte `Code.gs` tegen een nagebootste sheet, en de app in Chromium. |

Er staan geen sleutels, geen spreadsheet-ID's en geen klant- of productnamen in de code. De ID's van de productielijst en de poco list leest het script uit de IMPORTRANGE-formules van de sheet. De testgegevens zijn verzonnen.

De app staat op `https://lventureapps.github.io/qcrondgang/` (organisatie `lventureapps`, repository `qcrondgang`, Pages uit `/docs`). Palletscan blijft op `https://lventure.github.io/palletscan/`. Twee installeerbare apps op hetzelfde adres gaan op Android niet samen; daarom staan ze apart.

## Van fase 1 naar fase 2 en 3: wat je nu doet

De volgorde telt. Stap 2 moet voor stap 4.

1. Open de testkopie, Extensies > Apps Script. Vervang de inhoud van `Code.gs` door `apps-script/Code.gs` uit deze map. Bewaar.
2. Kies bovenaan de functie `installeer` en klik op Uitvoeren. Google vraagt opnieuw toestemming, nu ook voor Drive (de foto's). Geef ze. Sla deze stap niet over, om twee redenen. Zonder die toestemming antwoordt het script waarschijnlijk op elke actie van de tablet met een toestemmingspagina, ook op de gewone controles, en dan blijft de wachtrij staan (niet getest tegen Google; het is de reden voor de volgorde). En `installeer` voegt de kolom "Foto opmerking" toe; zonder die kolom weigert het script elke controle met de melding dat de kolom ontbreekt.
3. Kijk het uitvoeringslogboek na:
   - `Toegevoegd vanaf kolom BL: Gezien: THT ZK, Gezien: THT GRD` (de kolommen komen rechts van de bestaande kolommen van de app). "Foto opmerking" (BK) staat er al van de vorige keer.
   - `B  lijn  <- "Lijn"`. Staat er `??  lijn`, dan heet de kolom in rij 2 niet "Lijn" en komt de gekozen lijn niet in de sheet; al de rest werkt wel.
   - `Lijnen waaruit de controleur kiest: L0, L1, …`.
   - `Map voor de foto's: https://drive.google.com/…`. Open die map en deel ze met dezelfde mensen als de sheet. Anders krijgt een collega "toegang aanvragen" in plaats van de foto.
   - `Dagcontrole werk (…): 0 metingen, 29 controlepunten` met de lijst eronder, en `Dagcontrole magazijn (…): 3 metingen, … controlepunten`. Vergelijk de lijsten met de twee tabbladen.
   - Geen regel met `WAARSCHUWINGEN`, `??` of `FOUT`. Staat er "twee kolommen met dezelfde naam", geef dan in de sheet één van de twee een andere naam; zolang dat niet gebeurd is, werkt die dagcontrole niet (de productiecontroles wel).
4. Implementeren > Implementaties beheren > bewerken > Nieuwe versie. Het adres blijft hetzelfde.
5. Zet de inhoud van `docs/` in de repository `lventureapps/qcrondgang` en push. Na een paar minuten staat de nieuwe versie online.
6. Op de tablet: open de app, tik bovenaan op Bijwerken (of Instellingen > Op nieuwe versie controleren). Staat er "De app wordt bijgewerkt, maar een ander tabblad of venster … staat nog open", sluit dan het Chrome-tabblad van de app; het gaat daarna vanzelf verder.
7. Instellingen toont nu "Scherm: … × … punten". Geef me die twee getallen door, liggend en staand. Beneden is getekend om zonder schuiven te passen vanaf 1280 × 720 liggend en 800 × 1180 staand.
8. Bij de eerste foto vraagt Chrome toestemming voor de camera. Sta ze toe.

`installeer` mag je opnieuw uitvoeren: bestaande kolommen, de sleutel en de map blijven. `nakijken` schrijft niets en toont alleen het logboek van stap 3. `meet` schrijft niets en toont hoe lang elke stap duurt. `nieuweFotoMap` is alleen nodig als de map "QC foto's" definitief verwijderd is.

## Eerste installatie (al gebeurd voor fase 1)

1. Script: zoals stap 1 tot 4 hierboven. Voeg eerst de dienst Google Sheets API toe (links in de editor bij Diensten op +). Zonder die dienst werkt het script ook, maar veel trager: gemeten op 4 oktober 2026 duurt orders en pallets ophalen 2 seconden met de Sheets API en 64 seconden zonder. In het logboek van `installeer` staat de regel `SLEUTEL (ingeven op de tablet, niet delen): …`. Eerste implementatie: Implementeren > Nieuwe implementatie > type Web-app, Uitvoeren als: Ik, Toegang: Iedereen. Kopieer het adres dat eindigt op `/exec`.
2. GitHub Pages: Settings > Pages > Deploy from a branch > `main`, map `/docs`. Werk met git vanuit een gewone lokale map, niet vanuit Google Drive.
3. Tablet: open het adres in Chrome, plak het adres van het script en de sleutel, tik op Opslaan en testen. Daarna menu van Chrome > App installeren. Open de app altijd via het icoon.

`apps-script/` en `test/` mogen mee in de repository; er staat niets vertrouwelijks in.

## Wat er veranderd is in de app

- **Boven en Beneden elk op één scherm.** Elk punt is één regel met de naam links en de knoppen rechts, in kolommen naast elkaar: drie op een liggende tablet, twee op een staande. Open punten zijn rood omrand. De uitleg uit de kop van de sheet staat klein onder de naam; een tik op de naam toont ze volledig. Lange keuzelijsten (operatoren, trechters) zijn een uitklaplijst met exact de keuzes van de sheet, die begint op "Kies…".
- **THT.** Naast LOT ZK staat bij Beneden nu ook THT ZK, en naast LOT GRD bij Boven THT GRD (bij Beneden ook in het blok van Boven). De app haalt ze uit de productielijst, uit de kolommen "THT ZK" en "THT GRD", zoals de formules in L en AQ van de sheet dat doen. Voor een pallet toont de app wat de sheet toont: "Lot: …" en "THT: dd/mm/20jj" uit de poco list, en geen THT GRD. Wat de controleur zag, komt in de nieuwe kolommen "Gezien: THT ZK" en "Gezien: THT GRD".
- **Lijn.** Bovenaan Boven en Beneden kiest de controleur de lijn van de productie: altijd precies één van de lijst (L0 tot L10, MUL, STICKS, GELPACK 1, GELPACK 2, VOLPAK). Er staat niets vooraf ingevuld, want in de productielijst ligt de lijn vaak nog niet vast (daar staat dan een combinatie zoals "L1, L3, L5"). Zonder lijn sluit een deel niet af. De keuze geldt voor de hele controle: wat bij Boven gekozen is, staat bij Beneden al klaar en kan nog gewijzigd worden. Bij het verzenden komt de lijn als waarde in kolom B van die rij, in de plaats van de formule. In het zoekscherm staat de lijn niet meer; zoeken gaat op code of product.
- **Operatoren.** Eén punt "Operatoren" met een keuzescherm: tik iedereen aan die aan de lijn staat (één, twee, drie of meer). De knoppen zijn de keuzelijst van de kolom "Operator". Een naam die er niet in staat, typ je onderaan; ze staat er de volgende dagen als knop bij, tot ze 14 dagen niet meer gebruikt is. In de sheet komt de eerste naam in de eerste kolom "Operator" (Q) en de andere, met een komma ertussen, in de tweede (R). Met één of twee operatoren ziet een rij er dus uit zoals vandaag.
- **Mono/Duo en Snelheid** staan in één blok, altijd direct onder elkaar.
- **Foto's.** Camera in de pagina, foto verkleind tot 1600 punten langste zijde. De foto's van ZK en etiket zijn nodig om Beneden af te sluiten; die van het etiket mag op NVT. "Foto opmerking" is niet verplicht, bijvoorbeeld bij een NOK. In de sheet staat "volgt" tot de foto binnen is, daarna een link "Foto ZK", "Foto etiket" of "Foto opmerking" (nieuwe kolom, rechts). Een tik op de kleine foto toont ze groot.
- **Dagcontroles.** Twee tegels op het startscherm. Werkmaterialen boven werkt negatief, op één scherm: tik alleen aan wat niet OK was en schrijf erbij wat er scheelt; wat je niet aantikt, wordt OK bij het afsluiten. Op de afsluitknop staat wat je bevestigt, bijvoorbeeld "Afsluiten: 27 OK, 2 niet OK". Magazijn en bufferzone staat ook op één scherm: de drie metingen en daaronder elk punt met OK of NOK; bij NOK verschijnt het veld voor de opmerking onder dat punt. Een dagcontrole hoort bij de dag waarop ze begonnen is. Is ze niet afgesloten, dan staat ze de volgende dag op het startscherm onder "Dagcontroles van eerdere dagen".

## Testen op de tablet en in de sheet

Van fase 1 (nog altijd geldig):

1. Vliegtuigmodus aan, Boven invullen voor drie lijnen, app sluiten en heropenen, dan Beneden: de invoer van Boven staat links bovenaan. Vliegtuigmodus uit: alles komt één keer in de sheet.
2. Een deel afsluiten met een open punt: de app weigert en omrandt het punt rood.
3. Checkweger NEE: T, U en V tonen NVT en bevatten nog de formule. Corrigeren van JA naar NEE: de formule staat er weer. Zelfde voor Metaaldetector en X.
4. Een opmerking die begint met `=` of die op een datum lijkt (`3-4`): ze staat als gewone tekst in de sheet.
5. Per controlepunt de keuzes vergelijken met de keuzelijst van de kolom.

Nieuw:

6. Past Beneden op het scherm zonder schuiven, liggend en staand? Zijn de knoppen groot genoeg voor wie de controle doet?
7. Foto nemen van een echte gewichtsfiche. Tik op de kleine foto: is alles leesbaar? Zo niet, dan moet de foto groter bewaard worden.
7b. Operatoren: een controle met drie operatoren waarvan één niet in de lijst. In de eerste kolom "Operator" (R) staat de eerste naam, in de tweede (S) de andere twee met een komma. Die twee cellen tonen een waarschuwing van de gegevensvalidatie (rood hoekje); dat is de bedoeling. Weigert de sheet de waarde toch, dan zie je in de app "Fout: …": geef me die melding door.
7d. THT: vergelijk voor twee orders en één pallet THT ZK en THT GRD in de app met L en AQ in de sheet. De tekst kan licht verschillen als de productielijst een echte datum bevat (bijvoorbeeld "1/8/2029" tegenover "01/08/2029"): de app toont de datum zoals de productielijst ze toont.
7a. Lijn: bij een nieuwe controle staat er "Kies…", ook als de productielijst een lijn of een combinatie heeft. Zonder lijn sluit het deel niet af. Na het verzenden staat de gekozen lijn als gewone waarde in kolom B. Kijk of het maandoverzicht en de tellers die rijen nog bij de juiste lijn tellen.
7c. Foto opmerking nemen bij een NOK: de link staat in de nieuwe kolom. Een verzonden foto opnieuw nemen (Corrigeren): de cel wijst naar de nieuwe, de oude staat in de prullenbak van Drive.
8. Vliegtuigmodus aan, drie controles met foto's, app sluiten, vliegtuigmodus uit: elke rij heeft één link in "Foto ZK & Gewichtsfiche" (AL) en eventueel in "Foto etiket" (AM), in de map staat per foto één bestand.
9. Foto openen vanuit de sheet op een pc, met het account van een collega: hoogstens twee klikken, geen vraag om toegang.
10. Foto nemen tot Android het tabblad herlaadt (bijvoorbeeld via "Camera-app of bestand"): controle en foto zijn er nog.
11. Werkmaterialen boven: tik twee punten aan als niet OK, met een opmerking, en sluit af. In de rij van vandaag staat bij die twee de opmerking, bij alle andere "OK", en "Ja" in "Controle afgewerkt?". Sluit ook eens af zonder iets aan te tikken: alle punten "OK". Weigert de sheet "Ja" of een vrije tekst (validatie op de cel), dan zie je bovenaan in de app "Fout: …"; geef me die melding door.
12. Magazijn en bufferzone: metingen in B, C en D, per punt het juiste vakje, de opmerking bij NOK, "NVT" bij OK. Corrigeer daarna een NOK naar OK: in "Opmerking NOK" moet weer NVT staan en geen tekst die met `=IF(` begint.
13. Een dagcontrole beginnen en niet afsluiten; de dag erna staat ze op het startscherm en kan ze afgewerkt of verwijderd worden.
14. Maandoverzicht en tellers tonen dezelfde cijfers als bij handmatige invoer.

## Wat getest is en wat niet

Getest, hier in de bouwomgeving: 69 tests van `Code.gs` tegen een nagebootste sheet met de echte koppen, en 35 scenario's van de app in Chromium, met en zonder de nagebootste Sheets API. Ze slagen, drie volledige beurten na elkaar. De scenario's die eerder af en toe mislukten, deden dat door een fout in de test zelf (de test keek naar "Alles verzonden" voor het scherm opnieuw getekend was); dat is verbeterd.

Niet getest: fase 2 en 3 hebben nooit tegen Google zelf gedraaid en nooit op de tablet. De nagebootste sheet bewijst de logica, niet het gedrag van Google. Pas zeker na de stappen hierboven:

- alles van Drive: de map naast de sheet, het bestand, de link in de drie fotokolommen, en het verplaatsen van een vervangen foto naar de prullenbak;
- of een cel met een keuzelijst een naam buiten de lijst aanvaardt nadat het script de validatie van die ene cel op "waarschuwing tonen" zet (test 7b);
- of Drive een net bewaard bestand bij een herhaling binnen enkele seconden al terugvindt. Zo niet, dan kan er na een verloren bevestiging een tweede bestand in de map komen. De link in de sheet blijft juist.
- de dagtabbladen op de echte sheet (test 11 en 12);
- de camera in de geïnstalleerde app en de leesbaarheid van de foto (test 7);
- of Beneden op het echte scherm past (test 6).

De eerste rij die de app in fase 1 in de testkopie schreef (rij 1759) is nagekeken en klopt.

## Keuzes die je moet kennen

- Wordt een foto opnieuw genomen nadat ze verzonden is, dan krijgt de nieuwe een eigen bestand, wijst de cel naar de nieuwe en gaat de oude naar de prullenbak van Drive (daar blijft ze 30 dagen terug te halen). Hetzelfde gebeurt als een foto in de app gewist wordt of het etiket alsnog op NVT gaat. Het script verplaatst alleen een bestand dat het zelf voor die controle en die soort foto bewaard heeft, nooit een ander. Een oudere foto die te laat aankomt, vervangt nooit een nieuwere.
- Lijn: de app schrijft voor elke controle de gekozen lijn als waarde in kolom B; de formule van de sheet verdwijnt in die rij. Zo staat er op welke lijn er echt gecontroleerd is. Ook een pallet of een ingetypte code vraagt een lijn. Heeft kolom B een keuzelijst die de waarde niet kent, dan zet het script de validatie van die ene cel op "waarschuwing tonen". De lijst van lijnen staat bovenaan in `Code.gs` (`LIJNEN`); je kunt ze ook zonder code aanpassen met een Script Property `LIJNEN` (namen met een komma ertussen), gevolgd door Verversen op de tablet.
- Operatoren: de eerste naam in de eerste kolom "Operator" (R), de andere in de tweede (S) met een komma. Staat een naam niet in de keuzelijst, of staan er twee namen in S, dan zet het script de validatie van die ene cel op "waarschuwing tonen" in plaats van "weigeren". De keuzelijst zelf en de andere rijen wijzigen niet. Tellingen of filters per operator op de tweede kolom zien "CD, EF" als één waarde.
- De uitdrukkelijke keuze "Geen tweede operator" is weg: wie één operator aantikt, laat de tweede kolom "Operator" leeg.
- Een foto wordt pas verzonden nadat Beneden van die controle in de sheet staat. Verdwijnt de rij daarna uit de sheet (rij verwijderd, app-ID gewist), dan blijft de foto wachten en zegt de app waarom.
- Een dagcontrole van een eerdere dag afsluiten overschrijft wat er voor die dag al in de sheet staat. Bij Magazijn komt een dag die nog geen rij had onderaan, dus mogelijk onder de rij van vandaag.
- Corrigeren in de app kan op de dag zelf. Een dagcontrole die nog niet verzonden is, kan ook later nog gecorrigeerd worden.
- Werkmaterialen boven werkt negatief: iemand kan de dagcontrole afsluiten zonder iets aan te tikken, en dan staat elk punt als OK in de sheet. Daarom toont de afsluitknop het aantal. Magazijn en bufferzone blijft per punt OK of NOK vragen (niets vooraf ingevuld), nu op één scherm.

## Zelf de tests draaien (niet nodig om de app te gebruiken)

```
npm install
npx playwright install chromium
npm test
```

`npm start` zet de app met de nagebootste sheet op `http://localhost:8787/qc-rondgang/` en toont het adres en de sleutel om in te geven.

## Een nieuwe versie van de app uitbrengen

Verhoog het nummer in `docs/js/versie.js` bij elke wijziging aan de app. De tablet haalt de nieuwe bestanden op en toont bovenaan "Er is een nieuwe versie" met een knop Bijwerken. De app schakelt nooit vanzelf over midden in een controle. Ze zoekt zelf naar een nieuwe versie bij het openen en daarna hoogstens één keer per uur. Na een push duurt het een paar minuten voor GitHub Pages de nieuwe bestanden serveert. Na elke wijziging aan het script: Implementeren > Implementaties beheren > bewerken > Nieuwe versie.
