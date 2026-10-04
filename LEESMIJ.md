# QC Rondgang, fase 1

Webapp voor de dagelijkse kwaliteitsrondgang op een Android-tablet. Werkt zonder verbinding en verzendt zelf zodra er verbinding is. Het volledige ontwerp staat in `bouwplan-qc-rondgang.md`, één map hoger. Dat document bevat spreadsheet-ID's en hoort niet in de publieke repository.

Fase 1 bevat de productiecontroles (hoofdtabblad) zonder foto's: gegevens ophalen, Boven en Beneden invullen, wachtrij, app-ID tegen dubbels. Foto's (fase 2) en de twee dagtabbladen (fase 3) zitten er nog niet in. De controleur kan de sheet op de tablet dus nog niet loslaten.

## Wat staat waar

| Map | Inhoud |
|---|---|
| `docs/` | De app zelf. Dit is wat GitHub Pages serveert. |
| `apps-script/Code.gs` | Het script dat aan de sheet hangt. |
| `test/` | Tests: het echte `Code.gs` tegen een nagebootste sheet, en de app in Chromium. |

Er staan geen sleutels, geen spreadsheet-ID's en geen klant- of productnamen in de code. De ID's van de productielijst en de poco list leest het script uit de IMPORTRANGE-formules van de sheet. De testgegevens zijn verzonnen.

## Stap 1: het script aan de testkopie hangen

Doe dit op de testkopie, niet op de echte sheet.

1. Open de testkopie en kies Extensies > Apps Script.
2. Wis de inhoud van `Code.gs` in de editor en plak de inhoud van `apps-script/Code.gs`. Bewaar.
3. Kies bovenaan de functie `installeer` en klik op Uitvoeren. Google vraagt één keer toestemming; het script heeft toegang nodig tot deze sheet en tot de twee bronsheets.
4. Open het uitvoeringslogboek. Daar staat:
   - welke kolommen toegevoegd zijn (tien kolommen rechts van AX, vanaf AY);
   - de regel `SLEUTEL (ingeven op de tablet, niet delen): …`. Noteer die.
   - per controlepunt de gevonden kolomletter en de keuzelijst;
   - het aantal orders en pallets, en of ze rechtstreeks uit de bronsheets komen.
5. Kijk dat logboek na voor je verdergaat. Dit is de eerste keer dat het script tegen een echte Google Sheet draait. Let op:
   - geen regel met `??` of `FOUTEN`;
   - de kolomletters kloppen met het bouwplan (L, N, Q, R, S … AU);
   - bij elke keuzelijst staan de juiste keuzes;
   - orders en pallets komen `rechtstreeks`, niet uit het `importtabblad`;
   - de aantallen liggen in de buurt van wat je verwacht (op 2 oktober 132 orders en 68 pallets).
6. Kies Implementeren > Nieuwe implementatie > type Web-app. Uitvoeren als: Ik. Toegang: Iedereen. Kopieer het adres dat eindigt op `/exec`.

`installeer` mag je opnieuw uitvoeren: bestaande kolommen en de bestaande sleutel blijven. `nakijken` doet alleen de controle van punt 5 en schrijft niets. Na elke wijziging aan de code: Implementeren > Implementaties beheren > bewerken > Nieuwe versie. Het adres blijft dan hetzelfde.

## Stap 2: de app op GitHub Pages

1. Maak een nieuwe publieke repository `qc-rondgang` onder hetzelfde account als Palletscan.
2. Zet de inhoud van deze map erin. Werk met git vanuit een gewone lokale map, niet vanuit Google Drive: Drive en de map `.git` gaan slecht samen.
3. Settings > Pages > Deploy from a branch > `main`, map `/docs`.
4. De app staat dan op `https://<account>.github.io/qc-rondgang/`.
5. Kijk na dat de service worker van Palletscan alleen zijn eigen pad dekt. Een service worker die vanaf de hoofdmap van `<account>.github.io` geregistreerd is, zou ook deze app onderscheppen.

`apps-script/` en `test/` mogen mee in de repository; er staat niets vertrouwelijks in. Wil je alleen de app publiek, zet dan alleen `docs/` erin.

## Stap 3: de tablet

1. Open het adres in Chrome. Je ziet alleen het instelscherm.
2. Plak het adres van het script en de sleutel, en tik op Opslaan en testen. De app meldt met welke sheet en welk tabblad ze verbonden is en haalt de gegevens op.
3. Menu van Chrome > App installeren (of Toevoegen aan startscherm). Open de app daarna altijd via het icoon.
4. Bij Instellingen staat of Chrome vaste opslag heeft toegekend. Bij een geïnstalleerde app is dat normaal ja.

## Stap 4: testen in de productiezone

Deze punten uit hoofdstuk 11 van het bouwplan zijn op de echte tablet en tegen de echte testkopie na te lopen:

1. Vliegtuigmodus aan, Boven invullen voor drie lijnen, app sluiten en heropenen, dan Beneden: de invoer van Boven staat bij elke lijn bovenaan. Vliegtuigmodus uit: alles komt één keer in de sheet.
2. Boven verzenden met verbinding, Beneden later: zelfde rij, niets van Boven gewist.
3. Een deel afsluiten met een open punt: de app weigert en toont welk punt.
4. Tablet herstarten met een volle wachtrij: de wachtrij is er nog.
5. Code intypen die niet in de lijst zit: de rij komt in de sheet en de formules vullen product en lot aan.
6. Checkweger NEE: T, U en V tonen NVT en bevatten nog de formule. Checkweger JA: de antwoorden staan erin. Corrigeren naar NEE: de formule staat er weer. Zelfde voor Metaaldetector en X.
7. Per controlepunt de knoppen vergelijken met de keuzelijst van de kolom.
8. Maandoverzicht en tellers tonen dezelfde cijfers als bij handmatige invoer.
9. Een opmerking die begint met `=` of die op een datum lijkt (`3-4`): ze staat als gewone tekst in de sheet, zonder zichtbare apostrof.
10. Een verzonden deel corrigeren (knop Corrigeren, alleen op de dag zelf): de wijziging komt in dezelfde rij.

## Wat getest is en wat niet

Getest, hier in de bouwomgeving: 26 tests van `Code.gs` tegen een nagebootste sheet met de echte koppen, en 16 scenario's van de app in Chromium (vliegtuigmodus, heropenen, verloren bevestiging, dubbel verzoek, automatische NVT, verversen, corrigeren, verwijderen, Background Sync). Ze slagen allemaal.

Niet getest: het script is nooit tegen Google zelf uitgevoerd, en de app nooit op de tablet. De nagebootste sheet bewijst de logica, niet het gedrag van Google. Vier dingen zijn daarom pas zeker na stap 1 en stap 4:

- of Google de NVT-formule met puntkomma's aanvaardt bij het terugzetten (test 6);
- of een opmerking die met `=`, `+` of `-` begint als tekst in de cel komt (test 9);
- of het script de twee bronsheets rechtstreeks kan openen met jouw account;
- hoe lang een snapshot duurt. De app wacht 45 seconden; intussen blijft ze bruikbaar met de vorige gegevens.

De koppen van de testkopie en van de twee bronsheets zijn op 2 oktober 2026 wel uitgelezen; het script zoekt op die koppen.

## Zelf de tests draaien (niet nodig om de app te gebruiken)

```
npm install
npx playwright install chromium
npm test
```

`npm start` zet de app met de nagebootste sheet op `http://localhost:8787/qc-rondgang/` en toont het adres en de sleutel om in te geven.

## Een nieuwe versie van de app uitbrengen

Verhoog het nummer in `docs/js/versie.js` bij elke wijziging aan de app. De tablet haalt de nieuwe bestanden op en toont bovenaan "Er is een nieuwe versie" met een knop Bijwerken. De app schakelt nooit vanzelf over midden in een controle.
