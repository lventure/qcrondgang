// Test van apps-script/Code.gs tegen de nagebootste sheet. Uitvoeren: node test/script.test.cjs
const assert = require('assert');
const { laadScript, letterNaarKolom, lijstRegel } = require('./nep-apps-script.cjs');
const { maakFixture, OPERATOREN, FORMULE_KOLOMMEN, WERK_KOPPEN, MAGAZIJN_PUNTEN, dag, iso } = require('./fixture.cjs');

let geslaagd = 0;
const fouten = [];
function test(naam, fn) {
  try { fn(); geslaagd++; console.log('  ok   ' + naam); } catch (e) { fouten.push(naam); console.log('  FOUT ' + naam + '\n       ' + String(e.message).split('\n').join('\n       ')); }
}

function opzet(opties) {
  const fx = maakFixture(opties);
  const script = laadScript({ actief: fx.qc, opId: fx.opId });
  script.roep('installeer');
  const sleutel = script.props.SLEUTEL;
  const post = (obj) => script.post({ sleutel, ...obj });
  const cel = (r, l) => fx.tab.cel(r, letterNaarKolom(l)) || { v: '', f: '' };
  const w = (r, l) => fx.tab.waarde(r, letterNaarKolom(l));
  return { fx, script, sleutel, post, cel, w };
}

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const BOVEN = { deel: 'boven', datum: '2026-10-02', code: '260102', afgeslotenOm: '2026-10-02T07:15:00.000Z',
  waarden: { grdCorrect: true, allergeenEtiket: true, trechter: '7', ordeNetheid: 'OK', opmBoven: '' },
  vervallen: [], gezien: { grondstof: 'Proteïnepoeder D', lotGrd: '444444', allergenen: 'melk - soja' } };
const BENEDEN = { deel: 'beneden', datum: '2026-10-02', code: '260102', afgeslotenOm: '2026-10-02T09:40:00.000Z',
  waarden: { lotZkCorrect: true, allergenenCorrect: true, operator1: 'AB', operator2: '', checkweger: 'NEE', metaaldetector: 'NEE', monoDuo: '2', snelheid: '52',
    cProduct: 'OK', cHoudbaarheid: 'OK', cGewicht: 'OK', cZk: 'OK', cDi: 'NVT', cDs: 'OK', cEtiket: 'OK', cDocumenten: 'OK', cAllergenen: 'OK', opmBeneden: '' },
  vervallen: ['cwGewicht', 'cwPlus', 'cwMin', 'mdUitworp'], gezien: { product: 'Voorbeeld Proteïne 100ge', lotZk: 'LOT: 2600000102', allergenen: 'melk - soja' } };

console.log('Apps Script tegen de nagebootste sheet');

test('installeer voegt 11 kolommen toe vanaf AY en maakt een sleutel', () => {
  const { fx, sleutel, script } = opzet();
  assert.strictEqual(fx.tab.getMaxColumns(), 61);
  assert.strictEqual(fx.tab.cel(2, 51).v, 'App-ID');
  assert.strictEqual(fx.tab.cel(2, 60).v, 'Gezien: allergenen (boven)');
  assert.strictEqual(fx.tab.cel(2, 61).v, 'Foto opmerking');
  assert.ok(/^[0-9a-f]{64}$/.test(sleutel));
  script.roep('installeer'); // tweede keer: niets erbij, zelfde sleutel
  assert.strictEqual(fx.tab.getMaxColumns(), 61);
  assert.strictEqual(script.props.SLEUTEL, sleutel);
});

test('een sheet die de kolommen van fase 1 al heeft, krijgt alleen "Foto opmerking" erbij', () => {
  const fx = maakFixture();
  const script = laadScript({ actief: fx.qc, opId: fx.opId });
  script.roep('installeer');
  // terug naar de toestand van fase 1: de laatste kolom bestaat nog niet
  for (const k of [...fx.tab.cellen.keys()]) if (k.endsWith(',61')) fx.tab.cellen.delete(k);
  fx.tab.maxKolommen = 60;
  const a = script.post({ sleutel: script.props.SLEUTEL, actie: 'controle', appId: ID1, ...BENEDEN });
  assert.strictEqual(a.code, 'INDELING', 'zonder installeer() weigert het script te schrijven en zegt het welke kolom ontbreekt');
  assert.ok(/Foto opmerking/i.test(a.fout), a.fout);
  script.logboek.length = 0;
  script.roep('installeer');
  assert.strictEqual(fx.tab.getMaxColumns(), 61);
  assert.ok(script.logboek.some((l) => /Toegevoegd vanaf kolom BI: Foto opmerking/.test(l)), script.logboek.join('\n'));
  assert.strictEqual(script.post({ sleutel: script.props.SLEUTEL, actie: 'controle', appId: ID1, ...BENEDEN }).ok, true);
});

test('lijn: de keuze van de controleur vervangt de formule van de sheet in die rij; zonder keuze blijft de formule', () => {
  const { fx, script, post, w } = opzet();
  const f = (r) => fx.tab.cel(r, 2).f;
  const s = post({ actie: 'snapshot' });
  assert.deepStrictEqual(s.lijnen, ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10', 'MUL', 'STICKS', 'GELPACK 1', 'GELPACK 2', 'VOLPAK']);
  assert.deepStrictEqual(s.waarschuwingen, []);
  // zonder lijn (pallet, oudere app): de formule blijft
  post({ actie: 'controle', appId: ID1, ...BOVEN });
  assert.strictEqual(f(5), '=FORMULE_B(I5)');
  // met lijn: de waarde staat in B, bij Boven en later bij Beneden (gewijzigd)
  assert.strictEqual(post({ actie: 'controle', appId: ID2, ...BOVEN, code: '260103', lijn: 'L8' }).ok, true);
  assert.deepStrictEqual([w(6, 'B'), f(6)], ['L8', '']);
  post({ actie: 'controle', appId: ID2, ...BENEDEN, code: '260103', lijn: ' GELPACK  1 ' });
  assert.deepStrictEqual([w(6, 'B'), f(6)], ['GELPACK 1', '']);
  assert.strictEqual(w(6, 'AS'), 7, 'Boven is onaangeroerd');
  // de andere formulekolommen van de rij blijven formules
  assert.strictEqual(fx.tab.cel(6, letterNaarKolom('J')).f, '=FORMULE_J(I6)');
  assert.strictEqual(post({ actie: 'controle', appId: ID2, ...BENEDEN, code: '260103', lijn: 'x'.repeat(31) }).code, 'VERZOEK');
  // eigen lijst via Script Property LIJNEN
  script.props.LIJNEN = 'L1, L2 ,,VOLPAK,L1';
  assert.deepStrictEqual(post({ actie: 'snapshot' }).lijnen, ['L1', 'L2', 'VOLPAK']);
});

test('lijn: heeft kolom B een strenge keuzelijst, dan laat alleen die cel een andere waarde toe; ontbreekt de kolom, dan werkt de rest door', () => {
  const { fx, post, w } = opzet();
  for (let r = 3; r <= fx.tab.getMaxRows(); r++) fx.tab.cel(r, 2, true).dv = lijstRegel(['L1', 'L8']);
  post({ actie: 'controle', appId: ID1, ...BOVEN, lijn: 'L8' });
  assert.deepStrictEqual([w(5, 'B'), fx.tab.cel(5, 2).dv.getAllowInvalid()], ['L8', false]);
  post({ actie: 'controle', appId: ID2, ...BOVEN, code: '260103', lijn: 'VOLPAK' });
  assert.deepStrictEqual([w(6, 'B'), fx.tab.cel(6, 2).dv.getAllowInvalid(), fx.tab.cel(7, 2).dv.getAllowInvalid()], ['VOLPAK', true, false]);
  // kop hernoemd: geen fout, een waarschuwing, en de controle komt gewoon in de sheet
  fx.tab.cel(2, 2).v = 'Productielijn';
  const s = post({ actie: 'snapshot' });
  assert.strictEqual(s.ok, true);
  assert.ok(s.waarschuwingen.some((x) => /Kolom "Lijn" niet gevonden/.test(x)), s.waarschuwingen.join(' | '));
  const a = post({ actie: 'controle', appId: '33333333-3333-4333-8333-333333333333', ...BOVEN, code: '260104', lijn: 'L3' });
  assert.deepStrictEqual([a.ok, w(7, 'I'), fx.tab.cel(7, 2).f], [true, 260104, '=FORMULE_B(I7)']);
});

test('lijn: een rij die het script toevoegt onder een rij met een gekozen lijn, krijgt de formule van de sheet terug', () => {
  const { fx, post } = opzet();
  // alle voorbereide rijen opvullen, de laatste met een gekozen lijn
  let n = 0;
  const id = () => `44444444-4444-4444-8444-${String(++n).padStart(12, '0')}`;
  const laatsteVoorbereid = fx.tab.getMaxRows();
  for (let r = 5; r <= laatsteVoorbereid; r++) assert.strictEqual(post({ actie: 'controle', appId: id(), ...BOVEN, code: String(270000 + r), lijn: r === laatsteVoorbereid ? 'MUL' : '' }).rij, r);
  assert.strictEqual(fx.tab.cel(laatsteVoorbereid, 2).f, '');
  const a = post({ actie: 'controle', appId: id(), ...BOVEN, code: '279999' });
  assert.deepStrictEqual([a.ok, a.rij], [true, laatsteVoorbereid + 1]);
  assert.strictEqual(fx.tab.cel(laatsteVoorbereid + 1, 2).f, `=FORMULE_B(I${laatsteVoorbereid + 1})`, 'de formule komt van de dichtste rij die ze nog had');
  assert.strictEqual(fx.tab.waarde(laatsteVoorbereid + 1, 2), '');
});

test('operatoren: een naam buiten de lijst of meerdere namen komen in de cel; de keuzelijst van andere cellen blijft streng', () => {
  const { fx, post, w } = opzet();
  const dv = (r, l) => fx.tab.cel(r, letterNaarKolom(l)).dv;
  // gewone keuze uit de lijst: de validatie blijft zoals ze was
  post({ actie: 'controle', appId: ID1, ...BENEDEN });
  assert.deepStrictEqual([w(5, 'Q'), w(5, 'R'), dv(5, 'Q').getAllowInvalid()], ['AB', '', false]);
  // drie operatoren, waarvan één niet in de lijst
  const a = post({ actie: 'controle', appId: ID2, ...BENEDEN, code: '260103', waarden: { ...BENEDEN.waarden, operator1: 'Jan (interim)', operator2: 'CD, EF' } });
  assert.strictEqual(a.ok, true, a.fout);
  assert.deepStrictEqual([w(6, 'Q'), w(6, 'R')], ['Jan (interim)', 'CD, EF']);
  assert.deepStrictEqual([dv(6, 'Q').getAllowInvalid(), dv(6, 'R').getAllowInvalid()], [true, true], 'alleen deze twee cellen laten een andere waarde toe');
  assert.deepStrictEqual(dv(6, 'Q').getCriteriaValues()[0], dv(5, 'Q').getCriteriaValues()[0], 'de keuzelijst zelf is niet gewijzigd');
  assert.strictEqual(dv(7, 'Q').getAllowInvalid(), false);
  // een andere kolom met een keuzelijst weigert nog altijd een onbekende waarde
  const b = post({ actie: 'controle', appId: ID2, ...BENEDEN, code: '260103', afgeslotenOm: '2026-10-02T10:00:00.000Z', waarden: { ...BENEDEN.waarden, cProduct: 'misschien' } });
  assert.strictEqual(b.ok, false);
  // de snapshot geeft nog altijd de lijst uit de sheet
  assert.deepStrictEqual(post({ actie: 'snapshot' }).velden.operator1.keuzes, OPERATOREN);
  // correctie terug naar één operator uit de lijst
  post({ actie: 'controle', appId: ID2, ...BENEDEN, code: '260103', afgeslotenOm: '2026-10-02T10:05:00.000Z', waarden: { ...BENEDEN.waarden, operator1: 'CD', operator2: '' } });
  assert.deepStrictEqual([w(6, 'Q'), w(6, 'R')], ['CD', '']);
});

test('zonder of met verkeerde sleutel: geen gegevens en niets geschreven', () => {
  const { script, fx } = opzet();
  const voor = fx.tab.cellen.size;
  for (const s of [undefined, '', 'fout']) {
    assert.deepStrictEqual(script.post({ sleutel: s, actie: 'snapshot' }), { ok: false, code: 'SLEUTEL', fout: 'Sleutel geweigerd.' });
    assert.strictEqual(script.post({ sleutel: s, actie: 'controle', appId: ID1, ...BOVEN }).code, 'SLEUTEL');
  }
  assert.strictEqual(fx.tab.cellen.size, voor);
  assert.strictEqual(script.post('geen json').ok, false);
});

test('snapshot: orders volgens de statusregels', () => {
  const s = opzet().post({ actie: 'snapshot' });
  assert.strictEqual(s.ok, true);
  assert.deepStrictEqual(s.orders.map((o) => o.code), ['260101', '260102', '260103', '260104', '260107']);
  assert.deepStrictEqual(s.orders[1], { code: '260102', status: 'In productie', lijn: 'L8', product: 'Voorbeeld Proteïne 100ge', lotZk: 'LOT: 2600000102', inhoud: '100', eenheid: 'ge', grondstof: 'Proteïnepoeder D', lotGrd: '444444', allergenen: 'melk - soja' });
  assert.strictEqual(s.orders[4].lijn, '', '#N/A wordt leeg');
  assert.deepStrictEqual(s.bron, { orders: 'rechtstreeks', pallets: 'rechtstreeks' });
  assert.deepStrictEqual(s.waarschuwingen, []);
});

test('snapshot: pallets volgens de toestandsregels', () => {
  const s = opzet().post({ actie: 'snapshot' });
  assert.deepStrictEqual(s.pallets.map((p) => p.code), ['50001', '50002', '50004', '50006']);
  assert.deepStrictEqual(s.pallets[0], { code: '50001', toestand: 'PALL. BL. VOORHAND.', product: 'ART TACO 30X30G', lotZk: '439001', grondstof: 'KRUIDENMIX TACO 01', lotGrd: '439001', allergenen: 'Geen Allergenen boven' });
});

test('snapshot: keuzelijsten komen uit de gegevensvalidatie van de sheet', () => {
  const v = opzet().post({ actie: 'snapshot' }).velden;
  assert.deepStrictEqual(v.checkweger, { kolom: 'S', kop: 'Checkweger?', soort: 'lijst', keuzes: ['JA', 'NEE'] });
  assert.deepStrictEqual(v.cwPlus, { kolom: 'U', kop: 'Controle + 1 OK?', soort: 'lijst', keuzes: ['OK', 'NOK', 'NVT'] });
  assert.deepStrictEqual(v.cDi.keuzes, ['OK', 'NOK', 'NVT', 'STOP']);
  assert.strictEqual(v.operator1.kolom, 'Q');
  assert.strictEqual(v.operator2.kolom, 'R');
  assert.strictEqual(v.lotZkCorrect.soort, 'vakje');
  assert.strictEqual(v.trechter.keuzes.length, 12);
  assert.strictEqual(v.snelheid.soort, 'vrij');
  assert.strictEqual(v.cAllergenen.kolom, 'AJ');
  assert.strictEqual(v.ordeNetheid.kolom, 'AT');
});

test('snapshot: valt terug op het importtabblad als de bron niet te openen is', () => {
  const fx = maakFixture();
  // importtabblad met dezelfde gegevens, kolom A = extra Prod.Code zoals in de echte sheet
  const imp = fx.qc.getSheetByName('ImportProductielijst');
  ['Prod.Code', 'Nr', 'Prod.Code', 'Status', 'Klant + Product', 'Lijn'].forEach((k, i) => { imp.cel(2, i + 1, true).v = k; });
  [260101, 3, 260101, 'In productie', 'Voorbeeld Energiegel 40g', 'GELPACK 1'].forEach((v, i) => { imp.cel(3, i + 1, true).v = v; });
  const script = laadScript({ actief: fx.qc, opId: { } });
  script.roep('installeer');
  // pocolist: importtabblad is leeg (IMPORTRANGE niet geladen) -> fout, geen lege lijst
  let s = script.post({ sleutel: script.props.SLEUTEL, actie: 'snapshot' });
  assert.strictEqual(s.ok, false);
  assert.ok(/poco list/.test(s.fout), s.fout);
  // met gegevens in beide importtabbladen: snapshot uit de importtabbladen, met waarschuwing
  const imp2 = fx.qc.getSheetByName('poco list');
  ['', 'Palletnummer', 'asnartikelcode', 'asnlotn°', 'Toestand'].forEach((k, i) => { imp2.cel(1, i + 1, true).v = k; });
  imp2.cel(1, 1).f = '=IMPORTRANGE("x";"pocolist!1:6000")';
  [1, 50001, 'ART TACO 30X30G', 439001, 'Wachten'].forEach((v, i) => { imp2.cel(2, i + 1, true).v = v; });
  s = script.post({ sleutel: script.props.SLEUTEL, actie: 'snapshot' });
  assert.strictEqual(s.ok, true, s.fout);
  assert.deepStrictEqual(s.orders.map((o) => o.code), ['260101']);
  assert.deepStrictEqual(s.pallets.map((p) => p.code), ['50001']);
  assert.deepStrictEqual(s.bron, { orders: 'importtabblad', pallets: 'importtabblad' });
  assert.ok(s.waarschuwingen.some((x) => /verouderd/.test(x)));
});

test('Boven: nieuwe rij na de laatste ingevulde, alleen kolommen van Boven', () => {
  const { post, cel, w } = opzet();
  const a = post({ actie: 'controle', appId: ID1, ...BOVEN });
  assert.deepStrictEqual(a, { ok: true, appId: ID1, deel: 'boven', rij: 5, nieuw: true });
  assert.strictEqual(w(5, 'I'), 260102, 'code als getal, zodat de opzoekformules werken');
  assert.strictEqual(w(5, 'A').getTime(), new Date(2026, 9, 2).getTime());
  assert.strictEqual(w(5, 'AP'), true);
  assert.strictEqual(w(5, 'AR'), true);
  assert.strictEqual(w(5, 'AS'), 7);
  assert.strictEqual(w(5, 'AT'), 'OK');
  assert.strictEqual(w(5, 'AY'), ID1);
  assert.strictEqual(w(5, 'BF'), 'Proteïnepoeder D');
  assert.strictEqual(w(5, 'BG'), '444444', 'lot blijft tekst');
  assert.strictEqual(w(5, 'BH'), 'melk - soja');
  // niets van Beneden aangeraakt
  assert.strictEqual(w(5, 'L'), false);
  assert.strictEqual(w(5, 'Q'), '');
  assert.strictEqual(w(5, 'S'), '');
  assert.strictEqual(cel(5, 'T').f, '=IF(S5="nee";"NVT";)');
  assert.strictEqual(w(5, 'BA'), '', 'Beneden gecontroleerd om blijft leeg');
  assert.strictEqual(w(5, 'BC'), '', 'Gezien: product blijft leeg');
  // formules van de sheet onaangeroerd, AV en AW leeg
  FORMULE_KOLOMMEN.forEach((l) => assert.strictEqual(cel(5, l).f, `=FORMULE_${l}(I5)`));
  assert.strictEqual(w(5, 'AV'), '');
  assert.strictEqual(w(5, 'AW'), '');
});

test('Beneden later: zelfde rij, niets van Boven gewist', () => {
  const { post, w, fx } = opzet();
  post({ actie: 'controle', appId: ID1, ...BOVEN });
  const a = post({ actie: 'controle', appId: ID1, ...BENEDEN });
  assert.deepStrictEqual(a, { ok: true, appId: ID1, deel: 'beneden', rij: 5, nieuw: false });
  assert.strictEqual(w(5, 'AS'), 7);
  assert.strictEqual(w(5, 'AT'), 'OK');
  assert.strictEqual(w(5, 'AP'), true);
  assert.strictEqual(w(5, 'BF'), 'Proteïnepoeder D');
  assert.strictEqual(w(5, 'Q'), 'AB');
  assert.strictEqual(w(5, 'R'), '');
  assert.strictEqual(w(5, 'Y'), 2);
  assert.strictEqual(w(5, 'Z'), 52);
  assert.strictEqual(w(5, 'AF'), 'NVT');
  assert.strictEqual(w(5, 'BC'), 'Voorbeeld Proteïne 100ge');
  const isDatum = (x) => Object.prototype.toString.call(x) === '[object Date]';
  assert.ok(isDatum(w(5, 'AZ')) && isDatum(w(5, 'BA')) && isDatum(w(5, 'BB')));
  assert.strictEqual(w(5, 'AZ').toISOString(), '2026-10-02T07:15:00.000Z');
  assert.strictEqual(w(6, 'I'), '', 'geen tweede rij');
  assert.strictEqual(fx.tab.getMaxRows(), 7);
});

test('eerst Beneden, dan Boven: werkt in beide volgordes', () => {
  const { post, w } = opzet();
  assert.strictEqual(post({ actie: 'controle', appId: ID1, ...BENEDEN }).rij, 5);
  assert.strictEqual(post({ actie: 'controle', appId: ID1, ...BOVEN }).rij, 5);
  assert.strictEqual(w(5, 'Q'), 'AB');
  assert.strictEqual(w(5, 'AS'), 7);
});

test('hetzelfde verzoek twee keer: één rij', () => {
  const { post, w } = opzet();
  const a1 = post({ actie: 'controle', appId: ID1, ...BENEDEN });
  const a2 = post({ actie: 'controle', appId: ID1, ...BENEDEN });
  assert.strictEqual(a1.rij, 5);
  assert.deepStrictEqual(a2, { ok: true, appId: ID1, deel: 'beneden', rij: 5, nieuw: false });
  assert.strictEqual(w(6, 'I'), '');
  assert.strictEqual(w(6, 'AY'), '');
});

test('twee controles: twee rijen; zelfde app-ID met andere code wordt geweigerd', () => {
  const { post, w } = opzet();
  post({ actie: 'controle', appId: ID1, ...BOVEN });
  assert.strictEqual(post({ actie: 'controle', appId: ID2, ...BOVEN, code: '50001' }).rij, 6);
  assert.strictEqual(w(6, 'I'), 50001);
  const a = post({ actie: 'controle', appId: ID1, ...BENEDEN, code: '260103' });
  assert.strictEqual(a.code, 'CODE_VERSCHILT');
  assert.strictEqual(w(5, 'Q'), '', 'niets geschreven');
});

test('Checkweger NEE: T, U, V tonen NVT en houden de formule', () => {
  const { post, cel, w } = opzet();
  post({ actie: 'controle', appId: ID1, ...BENEDEN });
  ['T', 'U', 'V'].forEach((l) => { assert.strictEqual(cel(5, l).f, '=IF(S5="nee";"NVT";)'); assert.strictEqual(w(5, l), 'NVT'); });
  assert.strictEqual(cel(5, 'X').f, '=if(W5="nee";"NVT";)', 'de formule van de sheet zelf blijft staan');
  assert.strictEqual(w(5, 'X'), 'NVT');
});

test('Checkweger JA: antwoorden staan erin; corrigeren naar NEE zet de formule terug', () => {
  const { post, cel, w } = opzet();
  const ja = { ...BENEDEN, waarden: { ...BENEDEN.waarden, checkweger: 'JA', cwGewicht: 'OK', cwPlus: 'OK', cwMin: 'NOK', metaaldetector: 'JA', mdUitworp: 'OK', opmBeneden: 'controle -1 herhaald' }, vervallen: [] };
  post({ actie: 'controle', appId: ID1, ...ja });
  assert.strictEqual(cel(5, 'T').f, '');
  assert.deepStrictEqual(['T', 'U', 'V', 'X'].map((l) => w(5, l)), ['OK', 'OK', 'NOK', 'OK']);
  assert.strictEqual(w(5, 'AA'), 'controle -1 herhaald');
  post({ actie: 'controle', appId: ID1, ...BENEDEN });
  ['T', 'U', 'V'].forEach((l) => { assert.strictEqual(cel(5, l).f, '=IF(S5="nee";"NVT";)'); assert.strictEqual(w(5, l), 'NVT'); });
  assert.strictEqual(cel(5, 'X').f, '=IF(W5="nee";"NVT";)');
  assert.strictEqual(w(5, 'X'), 'NVT');
  assert.strictEqual(w(5, 'AA'), '', 'opmerking gewist bij de correctie');
});

test('vrije tekst wordt nooit een formule, datum of getal', () => {
  const { post, cel, w } = opzet();
  post({ actie: 'controle', appId: ID1, ...BOVEN, waarden: { ...BOVEN.waarden, opmBoven: '=IMPORTRANGE("x";"y")' } });
  assert.strictEqual(cel(5, 'AU').f, '');
  assert.strictEqual(w(5, 'AU'), '=IMPORTRANGE("x";"y")');
  post({ actie: 'controle', appId: ID1, ...BOVEN, waarden: { ...BOVEN.waarden, opmBoven: '3-4' } });
  assert.strictEqual(w(5, 'AU'), '3-4');
});

test('ingetypte code zonder opzoekwaarden: rij komt er, Gezien blijft leeg', () => {
  const { post, w } = opzet();
  const a = post({ actie: 'controle', appId: ID1, ...BOVEN, code: 'X-99', gezien: null });
  assert.strictEqual(a.rij, 5);
  assert.strictEqual(w(5, 'I'), 'X-99');
  assert.strictEqual(w(5, 'BF'), '');
});

test('geen voorbereide rijen meer: rij erbij met formules en validatie van de rij erboven', () => {
  const { post, cel, w, fx } = opzet({ legeRijen: 1 });
  assert.strictEqual(post({ actie: 'controle', appId: ID1, ...BENEDEN, waarden: { ...BENEDEN.waarden, checkweger: 'JA', cwGewicht: 'OK', cwPlus: 'OK', cwMin: 'OK' }, vervallen: ['mdUitworp'] }).rij, 5);
  const a = post({ actie: 'controle', appId: ID2, ...BOVEN, code: '260103' });
  assert.strictEqual(a.rij, 6);
  assert.strictEqual(fx.tab.getMaxRows(), 6);
  assert.strictEqual(w(6, 'I'), 260103);
  assert.strictEqual(w(6, 'AS'), 7);
  assert.strictEqual(cel(6, 'T').f, '=IF(S6="nee";"NVT";)', 'NVT-formule hersteld, niet het antwoord van de rij erboven');
  assert.strictEqual(w(6, 'Q'), '', 'invoer van de rij erboven niet meegekopieerd');
  assert.strictEqual(w(6, 'L'), false);
  assert.strictEqual(cel(6, 'J').f, '=FORMULE_J(I6)');
  assert.ok(cel(6, 'S').dv, 'keuzelijst meegekopieerd');
  assert.strictEqual(w(6, 'AY'), ID2);
  assert.strictEqual(w(5, 'AY'), ID1);
});

test('een keuze die niet in de keuzelijst staat: fout, en de herhaling maakt geen tweede rij', () => {
  const { post, w } = opzet();
  const a = post({ actie: 'controle', appId: ID1, ...BOVEN, waarden: { ...BOVEN.waarden, ordeNetheid: 'MISSCHIEN' } });
  assert.strictEqual(a.ok, false);
  assert.strictEqual(a.code, 'FOUT');
  const b = post({ actie: 'controle', appId: ID1, ...BOVEN });
  assert.deepStrictEqual([b.ok, b.rij, b.nieuw], [true, 5, false]);
  assert.strictEqual(w(6, 'I'), '');
});

test('na een fout is het slot weer vrij', () => {
  const { post, script } = opzet();
  post({ actie: 'controle', appId: ID1, ...BOVEN, waarden: { ...BOVEN.waarden, ordeNetheid: 'MISSCHIEN' } });
  assert.strictEqual(script.slot.bezet, false);
  script.slot.bezet = true;
  assert.strictEqual(post({ actie: 'controle', appId: ID1, ...BOVEN }).code, 'BEZET');
});

test('hernoemde kop: het script weigert te schrijven en zegt welke', () => {
  const { post, fx } = opzet();
  fx.tab.cel(2, letterNaarKolom('S')).v = 'CW aanwezig';
  const a = post({ actie: 'controle', appId: ID1, ...BENEDEN });
  assert.strictEqual(a.code, 'INDELING');
  assert.ok(/checkweger/.test(a.fout));
  assert.strictEqual(fx.tab.waarde(5, letterNaarKolom('I')), '');
});

test('ingevoegde kolom: het script volgt de koppen, niet de letters', () => {
  const fx = maakFixture();
  // schuif alles vanaf kolom S één plaats naar rechts
  const verplaatst = new Map();
  for (const [k, x] of fx.tab.cellen) {
    const [r, c] = k.split(',').map(Number);
    if (c >= 19 && x.f) x.f = x.f.replace(/\b([SW])(\d+)="nee"/, (m, l, n) => (l === 'S' ? 'T' : 'X') + n + '="nee"');
    verplaatst.set(r + ',' + (c >= 19 ? c + 1 : c), x);
  }
  fx.tab.cellen = verplaatst;
  fx.tab.maxKolommen += 1;
  const script = laadScript({ actief: fx.qc, opId: fx.opId });
  script.roep('installeer');
  const a = script.post({ sleutel: script.props.SLEUTEL, actie: 'controle', appId: ID1, ...BENEDEN });
  assert.strictEqual(a.ok, true);
  assert.strictEqual(fx.tab.waarde(5, letterNaarKolom('T')), 'NEE', 'Checkweger staat nu in T');
  assert.strictEqual(fx.tab.waarde(5, letterNaarKolom('U')), 'NVT');
});

test('een oud verzoek dat na een correctie aankomt, overschrijft de correctie niet', () => {
  const { post, w } = opzet();
  const v1 = { ...BOVEN, afgeslotenOm: '2026-10-02T07:15:00.000Z', waarden: { ...BOVEN.waarden, trechter: '2' } };
  const v2 = { ...BOVEN, afgeslotenOm: '2026-10-02T07:20:00.000Z', waarden: { ...BOVEN.waarden, trechter: '11' } };
  post({ actie: 'controle', appId: ID1, ...v2 });
  const laat = post({ actie: 'controle', appId: ID1, ...v1 });
  assert.deepStrictEqual(laat, { ok: true, appId: ID1, deel: 'boven', rij: 5, nieuw: false, verouderd: true });
  assert.strictEqual(w(5, 'AS'), 11);
  // dezelfde versie opnieuw (herhaling) schrijft gewoon
  assert.strictEqual(post({ actie: 'controle', appId: ID1, ...v2 }).verouderd, undefined);
});

test('codes met voorloopnul, streepje of letters blijven tekst en de herhaling vindt de rij terug', () => {
  const { post, w } = opzet();
  ['0123', '12-3', '1E5', '1234567890123456789'].forEach((code, i) => {
    const id = `3333333${i}-3333-4333-8333-333333333333`;
    const a = post({ actie: 'controle', appId: id, ...BOVEN, code, gezien: null });
    assert.deepStrictEqual([a.ok, a.rij], [true, 5 + i], code);
    assert.strictEqual(w(5 + i, 'I'), code);
    const b = post({ actie: 'controle', appId: id, ...BENEDEN, code, gezien: null });
    assert.deepStrictEqual([b.ok, b.rij, b.nieuw], [true, 5 + i, false], code);
  });
});

test('nieuwe rij onderaan neemt geen invoer mee uit kolommen buiten de app (foto, oude kolommen)', () => {
  const { post, cel, w, fx } = opzet({ legeRijen: 0 });
  ['AK', 'AL', 'AV', 'AW'].forEach((l) => { fx.tab.cel(4, letterNaarKolom(l), true).v = 'oud'; });
  const a = post({ actie: 'controle', appId: ID1, ...BOVEN });
  assert.strictEqual(a.rij, 5);
  ['AK', 'AL', 'AV', 'AW', 'Q', 'Z', 'AB'].forEach((l) => assert.strictEqual(w(5, l), '', l));
  assert.strictEqual(cel(5, 'J').f, '=FORMULE_J(I5)');
  assert.strictEqual(w(4, 'AK'), 'oud', 'de rij erboven blijft zoals ze was');
});

test('keuzelijsten: heeft de lege rij geen validatie, dan telt de rij erboven', () => {
  const { post, fx } = opzet();
  for (let c = 1; c <= 50; c++) { const x = fx.tab.cel(5, c); if (x) x.dv = null; }
  const v = post({ actie: 'snapshot' }).velden;
  assert.deepStrictEqual(v.checkweger.keuzes, ['JA', 'NEE']);
  assert.strictEqual(v.lotZkCorrect.soort, 'vakje');
});

test('met de Sheets API: zelfde snapshot, zonder de bronsheets te openen', () => {
  const gewoon = opzet().post({ actie: 'snapshot' });
  const fx = maakFixture();
  const script = laadScript({ actief: fx.qc, opId: fx.opId, sheetsDienst: true });
  script.roep('installeer');
  script.teller.openById = 0; script.teller.api = 0;
  const s = script.post({ sleutel: script.props.SLEUTEL, actie: 'snapshot' });
  assert.strictEqual(s.ok, true, s.fout);
  assert.deepStrictEqual(s.bron, { orders: 'Sheets API', pallets: 'Sheets API' });
  assert.deepStrictEqual(s.orders, gewoon.orders);
  assert.deepStrictEqual(s.pallets, gewoon.pallets);
  assert.deepStrictEqual(s.velden, gewoon.velden);
  assert.deepStrictEqual(s.waarschuwingen, []);
  assert.strictEqual(script.teller.openById, 0, 'geen enkele bronsheet geopend');
  assert.strictEqual(script.teller.api, 1 + 10 + 1 + 6 + 2 + 1 + 3, 'per bron de koprijen en de nodige kolommen, twee kolommen van het QC-tabblad en vier bereiken van de dagtabbladen');
});

test('Sheets API zonder toegang: de tragere weg neemt over en de app krijgt een waarschuwing', () => {
  const fx = maakFixture();
  const script = laadScript({ actief: fx.qc, opId: fx.opId, sheetsDienst: true });
  script.roep('installeer');
  script.teller.apiToegang = false;
  const s = script.post({ sleutel: script.props.SLEUTEL, actie: 'snapshot' });
  assert.strictEqual(s.ok, true, s.fout);
  assert.deepStrictEqual(s.bron, { orders: 'rechtstreeks', pallets: 'rechtstreeks' });
  assert.strictEqual(s.orders.length, 5);
  assert.strictEqual(s.waarschuwingen.length, 2);
  assert.ok(/Sheets API mislukte/.test(s.waarschuwingen[0]));
});

test('schrijven met de Sheets API: zelfde rijen als zonder, en geen kolom meer via SpreadsheetApp doorzocht', () => {
  const fx = maakFixture();
  const script = laadScript({ actief: fx.qc, opId: fx.opId, sheetsDienst: true });
  script.roep('installeer');
  const post = (obj) => script.post({ sleutel: script.props.SLEUTEL, ...obj });
  const w = (r, l) => fx.tab.waarde(r, letterNaarKolom(l));
  script.teller.api = 0;
  assert.deepStrictEqual(post({ actie: 'controle', appId: ID1, ...BOVEN }), { ok: true, appId: ID1, deel: 'boven', rij: 5, nieuw: true });
  assert.strictEqual(script.teller.api, 3, 'één verzoek met drie kolommen');
  assert.deepStrictEqual(post({ actie: 'controle', appId: ID1, ...BENEDEN }), { ok: true, appId: ID1, deel: 'beneden', rij: 5, nieuw: false });
  assert.strictEqual(post({ actie: 'controle', appId: ID2, ...BOVEN, code: '50001' }).rij, 6);
  assert.strictEqual(post({ actie: 'controle', appId: ID2, ...BOVEN, code: '50001' }).rij, 6);
  assert.strictEqual(post({ actie: 'controle', appId: '44444444-4444-4444-8444-444444444444', ...BOVEN, code: '260103' }).rij, 7);
  // geen voorbereide rijen meer: rij erbij
  assert.strictEqual(post({ actie: 'controle', appId: '55555555-5555-4555-8555-555555555555', ...BOVEN, code: '260104' }).rij, 8);
  assert.strictEqual(fx.tab.getMaxRows(), 8);
  assert.deepStrictEqual([w(5, 'I'), w(5, 'AS'), w(5, 'Q'), w(6, 'I'), w(7, 'I'), w(8, 'I'), w(8, 'AS')], [260102, 7, 'AB', 50001, 260103, 260104, 7]);
});

test('Sheets API loopt achter en wijst een bezette rij aan: niets overschreven, de tablet probeert opnieuw', () => {
  const fx = maakFixture();
  const script = laadScript({ actief: fx.qc, opId: fx.opId, sheetsDienst: true });
  script.roep('installeer');
  const post = (obj) => script.post({ sleutel: script.props.SLEUTEL, ...obj });
  const w = (r, l) => fx.tab.waarde(r, letterNaarKolom(l));
  post({ actie: 'controle', appId: ID1, ...BOVEN });
  script.teller.apiVerberg = 5; // de API ziet rij 5 nog als leeg
  const a = post({ actie: 'controle', appId: ID2, ...BOVEN, code: '50001' });
  assert.deepStrictEqual([a.ok, a.code, a.tijdelijk], [false, 'BEZET', true]);
  assert.deepStrictEqual([w(5, 'I'), w(5, 'AY'), w(6, 'I')], [260102, ID1, '']);
  assert.strictEqual(script.slot.bezet, false);
  script.teller.apiVerberg = 0;
  assert.strictEqual(post({ actie: 'controle', appId: ID2, ...BOVEN, code: '50001' }).rij, 6);
});

test('meet() schrijft niets en meet de drie wegen', () => {
  const fx = maakFixture();
  const script = laadScript({ actief: fx.qc, opId: fx.opId, sheetsDienst: true });
  script.roep('installeer');
  const beeld = () => JSON.stringify([...fx.tab.cellen].map(([k, x]) => [k, x.v instanceof Date ? x.v.getTime() : x.v, x.f]));
  const voor = beeld();
  script.logboek.length = 0;
  script.roep('meet');
  assert.strictEqual(beeld(), voor);
  const log = script.logboek.join('\n');
  assert.ok(/=== Zoals de app ze krijgt \(Sheets API staat aan\): \d+ ms, 5 orders \(Sheets API\), 4 pallets \(Sheets API\)/.test(log), log);
  assert.ok(/=== Bronsheets via SpreadsheetApp: \d+ ms, 5 orders \(rechtstreeks\)/.test(log), log);
  assert.ok(/=== Importtabbladen in de QC-sheet: \d+ ms, FOUT/.test(log), 'importtabbladen zijn leeg in de nep');
  assert.ok(/Verschil "Bronsheets via SpreadsheetApp" tegenover de eerste weg: 0 codes ontbreken, 0 codes extra/.test(log), log);
  assert.ok(/=== Leeswerk voor een schrijfactie: \d+ ms/.test(log));
  assert.ok(!log.includes(script.props.SLEUTEL), 'geen sleutel in het logboek');
  assert.ok(!/Voorbeeld|Testklant/.test(log), 'geen productnamen in het logboek');
  // na meet() staat de klok weer uit
  assert.strictEqual(script.post({ sleutel: script.props.SLEUTEL, actie: 'snapshot' }).ok, true);
});

// ---------------------------------------------------------------- fase 2: foto's
const FOTO = { actie: 'foto', appId: ID1, soort: 'zk', fotoId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', datum: '2026-10-02', code: '260102', lijn: 'L8', data: Buffer.from('x'.repeat(300)).toString('base64') };
const link = (fx, r, l) => (fx.tab.cel(r, letterNaarKolom(l)) || {}).link || '';

for (const metApi of [false, true]) {
  const naam = metApi ? ' (met Sheets API)' : '';
  const opzetF = () => {
    const fx = maakFixture();
    const script = laadScript({ actief: fx.qc, opId: fx.opId, sheetsDienst: metApi });
    script.roep('installeer');
    return { fx, script, post: (obj) => script.post({ sleutel: script.props.SLEUTEL, ...obj }), w: (r, l) => fx.tab.waarde(r, letterNaarKolom(l)) };
  };

  test('installeer maakt de map voor de foto\'s naast de sheet, één keer' + naam, () => {
    const { script } = opzetF();
    const id = script.props.FOTO_MAP_ID;
    assert.ok(id);
    assert.strictEqual(script.drive.perId[id].naam, "QC foto's");
    assert.strictEqual(script.drive.perId[id].ouder.naam, 'Kwaliteit');
    script.roep('installeer');
    assert.strictEqual(script.props.FOTO_MAP_ID, id);
    assert.strictEqual(script.drive.sheetMap.mappen.length, 1);
    assert.ok(script.logboek.some((l) => /Map voor de foto's: https:\/\/drive\.google\.com\/drive\/folders\//.test(l)));
  });

  test('foto voor een controle die nog niet in de sheet staat: later opnieuw, niets bewaard' + naam, () => {
    const { script, post } = opzetF();
    const a = post(FOTO);
    assert.deepStrictEqual([a.ok, a.code, a.tijdelijk], [false, 'LATER', true]);
    assert.strictEqual(script.drive.alleBestanden().length, 0);
  });

  test('Beneden zet "volgt", de foto vervangt dat door een link, en een herhaling maakt geen tweede bestand' + naam, () => {
    const { fx, script, post, w } = opzetF();
    post({ actie: 'controle', appId: ID1, ...BENEDEN, fotos: { zk: 'volgt', etiket: 'nvt' } });
    assert.deepStrictEqual([w(5, 'AK'), w(5, 'AL')], ['volgt', '']);
    const a = post(FOTO);
    assert.deepStrictEqual([a.ok, a.rij, a.nieuw, a.fotoId, a.soort], [true, 5, true, FOTO.fotoId, 'zk']);
    assert.strictEqual(w(5, 'AK'), 'Foto ZK');
    assert.ok(/^https:\/\/drive\.google\.com\/file\/d\//.test(link(fx, 5, 'AK')));
    const b = post(FOTO);
    assert.deepStrictEqual([b.ok, b.nieuw], [true, false]);
    const bestanden = script.drive.alleBestanden();
    assert.strictEqual(bestanden.length, 1);
    assert.deepStrictEqual([bestanden[0].map, bestanden[0].naam, bestanden[0].bytes], ['2026-10', '2026-10-02_L8_260102_ZK_aaaaaaaa.jpg', 300]);
    assert.strictEqual(link(fx, 5, 'AK'), bestanden[0].url);
    // een correctie van Beneden laat de link staan
    post({ actie: 'controle', appId: ID1, ...BENEDEN, fotos: { zk: 'volgt', etiket: 'nvt' } });
    assert.strictEqual(w(5, 'AK'), 'Foto ZK');
    assert.strictEqual(link(fx, 5, 'AK'), bestanden[0].url);
    // niets anders in de rij aangeraakt
    assert.strictEqual(w(5, 'Q'), 'AB');
    assert.strictEqual(w(6, 'AK'), '');
  });

  test('foto etiket komt in AL; opnieuw genomen: de cel wijst naar de nieuwe en de oude gaat naar de prullenbak' + naam, () => {
    const { fx, script, post, w } = opzetF();
    const inPrullenbak = () => script.drive.alleBestanden().filter((b) => b.prullenbak).map((b) => b.naam).sort();
    post({ actie: 'controle', appId: ID1, ...BENEDEN, fotos: { zk: 'volgt', etiket: 'volgt' } });
    const a = post({ ...FOTO, soort: 'etiket', fotoId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    assert.deepStrictEqual([a.ok, a.oudWeg], [true, false]);
    assert.strictEqual(w(5, 'AL'), 'Foto etiket');
    assert.strictEqual(w(5, 'AK'), 'volgt');
    const eerste = link(fx, 5, 'AL');
    // dezelfde foto nog eens (verloren bevestiging): niets naar de prullenbak
    assert.strictEqual(post({ ...FOTO, soort: 'etiket', fotoId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }).oudWeg, false);
    assert.deepStrictEqual(inPrullenbak(), []);
    const b = post({ ...FOTO, soort: 'etiket', fotoId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
    assert.strictEqual(b.oudWeg, true);
    assert.notStrictEqual(link(fx, 5, 'AL'), eerste);
    assert.deepStrictEqual(script.drive.alleBestanden().map((x) => x.naam).sort(), ['2026-10-02_L8_260102_etiket_bbbbbbbb.jpg', '2026-10-02_L8_260102_etiket_cccccccc.jpg']);
    assert.deepStrictEqual(inPrullenbak(), ['2026-10-02_L8_260102_etiket_bbbbbbbb.jpg']);
    // een verzoek van de eerste foto komt nog eens aan, te laat (zonder tijdstip: oude app): het script kan dat niet weten en volgt het verzoek
    // met tijdstip: de nieuwere foto blijft staan en er komt geen bestand bij
    const C = { ...FOTO, soort: 'etiket', fotoId: '99999999-9999-4999-8999-999999999999', genomenOm: '2026-10-02T09:30:00.000Z' };
    const D = { ...FOTO, soort: 'etiket', fotoId: '88888888-8888-4888-8888-888888888888', genomenOm: '2026-10-02T09:35:00.000Z' };
    post(C);
    assert.strictEqual(post(D).oudWeg, true);
    const naD = link(fx, 5, 'AL');
    const aantal = script.drive.alleBestanden().length;
    const laat = post(C);
    assert.deepStrictEqual([laat.ok, laat.verouderd], [true, true], 'een oudere foto vervangt nooit een nieuwere');
    assert.strictEqual(link(fx, 5, 'AL'), naD);
    assert.strictEqual(script.drive.alleBestanden().length, aantal);
    assert.strictEqual(script.drive.alleBestanden().find((x) => /88888888/.test(x.naam)).prullenbak, false);
    assert.strictEqual(post(D).nieuw, false, 'de nieuwste foto nog eens: zelfde bestand');
    // etiket alsnog "niet van toepassing": de cel wordt leeg en ook die foto gaat naar de prullenbak
    post({ actie: 'controle', appId: ID1, ...BENEDEN, afgeslotenOm: '2026-10-02T09:50:00.000Z', fotos: { zk: 'volgt', etiket: 'nvt' } });
    assert.deepStrictEqual([w(5, 'AL'), link(fx, 5, 'AL')], ['', '']);
    assert.strictEqual(script.drive.alleBestanden().filter((x) => !x.prullenbak).length, 0, 'geen enkele foto van het etiket staat nog buiten de prullenbak');
  });

  test('alleen een eigen foto van dezelfde controle en soort gaat naar de prullenbak, nooit een ander bestand' + naam, () => {
    const { fx, script, post } = opzetF();
    post({ actie: 'controle', appId: ID1, ...BENEDEN, fotos: { zk: 'volgt', etiket: 'nvt' } });
    post({ actie: 'controle', appId: ID2, ...BENEDEN, code: '260103', fotos: { zk: 'volgt', etiket: 'nvt' } });
    post(FOTO);
    const vanControle1 = link(fx, 5, 'AK');
    // iemand plakt in de rij van controle 2 een link naar de foto van controle 1, en in een andere rij een eigen document
    const map = script.drive.perId[script.props.FOTO_MAP_ID];
    const vreemd = map.createFile({ naam: 'offerte.pdf', type: 'application/pdf', bytes: [1, 2, 3] });
    Object.assign(fx.tab.cel(6, letterNaarKolom('AK')), { v: 'Foto ZK', link: vanControle1 });
    const a = post({ ...FOTO, appId: ID2, code: '260103', fotoId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });
    assert.deepStrictEqual([a.ok, a.oudWeg], [true, false], 'de foto van een andere controle blijft staan');
    Object.assign(fx.tab.cel(6, letterNaarKolom('AK')), { v: 'Foto ZK', link: vreemd.getUrl() });
    const b = post({ ...FOTO, appId: ID2, code: '260103', fotoId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' });
    assert.deepStrictEqual([b.ok, b.oudWeg], [true, false], 'een bestand dat het script niet zelf bewaard heeft, blijft staan');
    assert.deepStrictEqual(script.drive.alleBestanden().filter((x) => x.prullenbak).length, 0);
  });

  test('foto opmerking: optionele derde foto in een eigen kolom' + naam, () => {
    const { fx, script, post, w } = opzetF();
    post({ actie: 'controle', appId: ID1, ...BENEDEN, fotos: { zk: 'volgt', etiket: 'nvt', opmerking: 'volgt' } });
    assert.deepStrictEqual([w(5, 'AK'), w(5, 'AL'), w(5, 'BI')], ['volgt', '', 'volgt']);
    const a = post({ ...FOTO, soort: 'opmerking', fotoId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' });
    assert.strictEqual(a.ok, true, a.fout);
    assert.deepStrictEqual([w(5, 'BI'), link(fx, 5, 'BI')], ['Foto opmerking', script.drive.alleBestanden()[0].url]);
    assert.strictEqual(script.drive.alleBestanden()[0].naam, '2026-10-02_L8_260102_opmerking_ffffffff.jpg');
    assert.strictEqual(w(5, 'AK'), 'volgt');
    // een oudere versie van de app kent de derde foto niet: de cel blijft onaangeroerd
    post({ actie: 'controle', appId: ID1, ...BENEDEN, afgeslotenOm: '2026-10-02T09:50:00.000Z', fotos: { zk: 'volgt', etiket: 'nvt' } });
    assert.strictEqual(w(5, 'BI'), 'Foto opmerking');
    // gewist in de app: cel leeg, foto naar de prullenbak
    post({ actie: 'controle', appId: ID1, ...BENEDEN, afgeslotenOm: '2026-10-02T09:55:00.000Z', fotos: { zk: 'volgt', etiket: 'nvt', opmerking: 'nvt' } });
    assert.deepStrictEqual([w(5, 'BI'), script.drive.alleBestanden()[0].prullenbak], ['', true]);
  });

  test('ongeldige foto-verzoeken; bestandsnaam zonder vreemde tekens' + naam, () => {
    const { script, post } = opzetF();
    post({ actie: 'controle', appId: ID1, ...BENEDEN, code: 'X/9 9' , gezien: null });
    assert.strictEqual(post({ ...FOTO, soort: 'selfie' }).code, 'VERZOEK');
    assert.strictEqual(post({ ...FOTO, fotoId: 'x' }).code, 'VERZOEK');
    assert.strictEqual(post({ ...FOTO, data: '' }).code, 'VERZOEK');
    assert.strictEqual(post({ ...FOTO, sleutel: 'fout' }).code, 'SLEUTEL');
    assert.strictEqual(script.drive.alleBestanden().length, 0);
    assert.strictEqual(post({ ...FOTO, code: 'X/9 9', lijn: '' }).ok, true);
    assert.strictEqual(script.drive.alleBestanden()[0].naam, '2026-10-02_x_X-9-9_ZK_aaaaaaaa.jpg');
  });

  test('rij verschuift terwijl de foto bewaard wordt: geen link in de rij van een andere controle, de herhaling zet ze juist' + naam, () => {
    const { fx, script, post, w } = opzetF();
    post({ actie: 'controle', appId: ID1, ...BENEDEN, fotos: { zk: 'volgt', etiket: 'nvt' } });
    post({ actie: 'controle', appId: ID2, ...BENEDEN, code: '260103', fotos: { zk: 'volgt', etiket: 'nvt' } });
    const wissel = (a, b) => {
      const na = new Map();
      for (const [k, x] of fx.tab.cellen) { const [r, c] = k.split(',').map(Number); na.set((r === a ? b : r === b ? a : r) + ',' + c, x); }
      fx.tab.cellen = na;
    };
    script.drive.bijMaken = () => { script.drive.bijMaken = null; wissel(5, 6); }; // iemand sorteert tijdens het bewaren
    const a = post(FOTO);
    assert.deepStrictEqual([a.ok, a.code, a.tijdelijk], [false, 'BEZET', true]);
    assert.deepStrictEqual([w(5, 'AK'), link(fx, 5, 'AK'), w(6, 'AK'), link(fx, 6, 'AK')], ['volgt', '', 'volgt', ''], 'nog nergens een link');
    const b = post(FOTO);
    assert.deepStrictEqual([b.ok, b.rij, b.nieuw], [true, 6, false]);
    assert.strictEqual(script.drive.alleBestanden().length, 1, 'geen tweede bestand');
    assert.deepStrictEqual([w(6, 'AK'), link(fx, 6, 'AK'), w(5, 'AK'), link(fx, 5, 'AK')], ['Foto ZK', script.drive.alleBestanden()[0].url, 'volgt', '']);
  });

  test('storing bij Drive of map in de prullenbak: geen tweede map, de tablet probeert later opnieuw' + naam, () => {
    const { script, post, w } = opzetF();
    post({ actie: 'controle', appId: ID1, ...BENEDEN, fotos: { zk: 'volgt', etiket: 'nvt' } });
    const id = script.props.FOTO_MAP_ID;
    script.drive.storing = true;
    const a = post(FOTO);
    assert.deepStrictEqual([a.ok, a.code], [false, 'FOUT']);
    assert.ok(/niet bereikbaar/.test(a.fout), a.fout);
    script.drive.storing = false;
    assert.strictEqual(script.props.FOTO_MAP_ID, id);
    assert.strictEqual(script.drive.sheetMap.mappen.length, 1);
    assert.strictEqual(w(5, 'AK'), 'volgt');
    script.drive.perId[id].prullenbak = true;
    const b = post(FOTO);
    assert.ok(b.ok === false && /prullenbak/.test(b.fout), b.fout);
    assert.strictEqual(script.drive.alleBestanden().length, 0);
    assert.strictEqual(script.slot.bezet, false, 'het slot is vrijgegeven na een fout');
    // een maandmap of bestand in de prullenbak wordt niet hergebruikt
    script.drive.perId[id].prullenbak = false;
    assert.strictEqual(post(FOTO).ok, true);
    const maand = script.drive.perId[id].mappen[0];
    maand.bestanden[0].prullenbak = true;
    assert.deepStrictEqual([post(FOTO).nieuw, maand.bestanden.length], [true, 2], 'bestand in de prullenbak: nieuw bestand');
    maand.prullenbak = true;
    assert.strictEqual(post(FOTO).nieuw, true);
    assert.strictEqual(script.drive.perId[id].mappen.length, 2, 'maandmap in de prullenbak: nieuwe maandmap');
    script.drive.perId[id].prullenbak = true;
    // de map is echt weg: nieuweFotoMap() maakt er bewust een nieuwe
    script.roep('nieuweFotoMap');
    assert.notStrictEqual(script.props.FOTO_MAP_ID, id);
    assert.strictEqual(post(FOTO).ok, true);
    assert.strictEqual(w(5, 'AK'), 'Foto ZK');
  });

  // -------------------------------------------------------------- fase 3: dagtabbladen
  const VANDAAG = iso(dag(0));
  const werkPunten = (afwijking) => WERK_KOPPEN.map((k) => ({ kop: k.split('\n')[0], ok: true })).map((p) => (afwijking && p.kop === afwijking.kop ? { kop: p.kop, ok: false, tekst: afwijking.tekst } : p));
  const magPunten = (nok) => MAGAZIJN_PUNTEN.filter((p) => p.actief).map((p) => (nok && p.ok === nok.ok ? { kop: p.kop, ok: false, tekst: nok.tekst } : { kop: p.kop, ok: true }));
  const METINGEN = [{ kop: 'Temperatuur magazijn (in C°)', waarde: '21,5' }, { kop: 'Temperatuur Koelkast eetzaal', waarde: '3' }, { kop: 'Luchtvochtigheid magazijn (in %)20,7', waarde: '48' }];

  test('snapshot geeft de controlepunten van de twee dagtabbladen' + naam, () => {
    const { post } = opzetF();
    const s = post({ actie: 'snapshot' });
    assert.deepStrictEqual(s.waarschuwingen, []);
    assert.strictEqual(s.dag.werk.punten.length, 9);
    assert.deepStrictEqual(s.dag.werk.punten[0], { kop: 'Trechter 1 - Vierkant', hulp: 'Mes ok?' });
    assert.deepStrictEqual(s.dag.werk.punten[4], { kop: 'Werk- & poetsmateriaal L4', hulp: 'Platte schroevendraaier · Vloerborstel · ok?' });
    assert.deepStrictEqual(s.dag.werk.metingen, []);
    assert.deepStrictEqual(s.dag.magazijn.metingen.map((m) => m.kop), METINGEN.map((m) => m.kop));
    assert.deepStrictEqual(s.dag.magazijn.punten.map((p) => p.kop), MAGAZIJN_PUNTEN.filter((p) => p.actief).map((p) => p.kop), 'het punt zonder selectievakjes telt niet mee');
  });

  test('werkmaterialen: rij van de datum, OK of de opmerking, "Ja" in de laatste kolom; opnieuw verzenden overschrijft' + naam, () => {
    const { fx, post } = opzetF();
    const ww = (r, c) => fx.werk.waarde(r, c);
    const a = post({ actie: 'dagcontrole', soort: 'werk', datum: VANDAAG, afgeslotenOm: new Date().toISOString(), punten: werkPunten({ kop: 'Mottenval L4', tekst: '6 motten' }) });
    assert.deepStrictEqual(a, { ok: true, soort: 'werk', datum: VANDAAG, rij: 10, nieuw: false });
    assert.deepStrictEqual([ww(10, 2), ww(10, 5), ww(10, 10), ww(10, 11)], ['OK', 'OK', '6 motten', 'Ja']);
    assert.strictEqual(ww(10, 1).getTime(), dag(0).getTime(), 'de datum blijft zoals ze stond');
    assert.strictEqual(ww(9, 2), '');
    assert.strictEqual(ww(11, 2), '');
    const b = post({ actie: 'dagcontrole', soort: 'werk', datum: VANDAAG, afgeslotenOm: new Date().toISOString(), punten: werkPunten({ kop: 'Takel 1', tekst: '=hamer weg' }) });
    assert.strictEqual(b.rij, 10);
    assert.deepStrictEqual([ww(10, 8), ww(10, 10)], ['=hamer weg', 'OK']);
    assert.strictEqual(fx.werk.cel(10, 8).f, '', 'een opmerking wordt nooit een formule');
  });

  test('werkmaterialen: datum na de laatste voorbereide dag komt in de volgende rij' + naam, () => {
    const { fx, script, post } = opzetF();
    const later = iso(dag(9));
    const a = post({ actie: 'dagcontrole', soort: 'werk', datum: later, afgeslotenOm: new Date().toISOString(), punten: werkPunten() });
    assert.deepStrictEqual([a.ok, a.rij, a.nieuw], [true, 16, true]);
    assert.strictEqual(fx.werk.getMaxRows(), 16);
    assert.strictEqual(fx.werk.waarde(16, 1).getTime(), dag(9).getTime());
    assert.strictEqual(post({ actie: 'dagcontrole', soort: 'werk', datum: later, afgeslotenOm: new Date().toISOString(), punten: werkPunten() }).rij, 16);
    // De leesactie loopt achter en ziet de nieuwe rij nog niet: niets schrijven, opnieuw proberen.
    if (metApi) {
      script.teller.apiVerberg = 16;
      const c = post({ actie: 'dagcontrole', soort: 'werk', datum: later, afgeslotenOm: new Date().toISOString(), punten: werkPunten({ kop: 'Takel 1', tekst: 'x' }) });
      assert.deepStrictEqual([c.ok, c.code, c.tijdelijk], [false, 'BEZET', true]);
      assert.strictEqual(fx.werk.getMaxRows(), 16, 'geen tweede rij voor dezelfde dag');
      assert.strictEqual(fx.werk.waarde(16, 8), 'OK');
      script.teller.apiVerberg = 0;
    }
  });

  test('dagtabblad met twee kolommen met dezelfde naam: duidelijke fout, niets geschreven' + naam, () => {
    const { fx, post } = opzetF();
    fx.werk.cel(2, 9, true).v = 'Takel 1\nKetting ok?'; // stond er "Takel 2"
    const s = post({ actie: 'snapshot' });
    assert.strictEqual(s.ok, true, 'de productiecontroles blijven werken');
    assert.strictEqual(s.dag.werk, null);
    assert.ok(s.waarschuwingen.some((x) => /twee kolommen met dezelfde naam: "Takel 1"/.test(x)), s.waarschuwingen.join(' | '));
    assert.ok(s.dag.magazijn);
    const a = post({ actie: 'dagcontrole', soort: 'werk', datum: VANDAAG, afgeslotenOm: 'x', punten: werkPunten() });
    assert.strictEqual(a.code, 'INDELING');
    assert.strictEqual(fx.werk.waarde(10, 2), '');
  });

  test('magazijn: nieuwe dag in de eerste vrije rij, metingen als getal, vakjes en "Opmerking NOK"' + naam, () => {
    const { fx, post } = opzetF();
    const mw = (r, l) => fx.mag.waarde(r, letterNaarKolom(l));
    const mf = (r, l) => (fx.mag.cel(r, letterNaarKolom(l)) || {}).f || '';
    const om = new Date(); om.setHours(9, 15, 0, 0);
    const a = post({ actie: 'dagcontrole', soort: 'magazijn', datum: VANDAAG, afgeslotenOm: om.toISOString(), metingen: METINGEN, punten: magPunten({ ok: 'N', tekst: 'muizenkeutels aan poort 2' }) });
    assert.deepStrictEqual(a, { ok: true, soort: 'magazijn', datum: VANDAAG, rij: 6, nieuw: true });
    assert.deepStrictEqual([mw(6, 'B'), mw(6, 'C'), mw(6, 'D')], [21.5, 3, 48]);
    assert.strictEqual(mw(6, 'A').getTime(), om.getTime(), 'kolom A krijgt het tijdstip van de controle, niet van het verzenden');
    assert.strictEqual(mf(6, 'A'), '');
    assert.deepStrictEqual([mw(6, 'E'), mw(6, 'F'), mw(6, 'G'), mf(6, 'G')], [true, false, 'NVT', '=if(E6;"NVT";)']);
    assert.deepStrictEqual([mw(6, 'N'), mw(6, 'O'), mw(6, 'P'), mf(6, 'P')], [false, true, 'muizenkeutels aan poort 2', '']);
    assert.deepStrictEqual([mw(6, 'K'), mw(6, 'L'), mw(6, 'M')], ['', '', ''], 'het punt zonder selectievakjes blijft leeg');
    assert.strictEqual(mw(5, 'J'), 'heftruck vuil', 'de vorige dag is onaangeroerd');
    assert.strictEqual(mw(7, 'B'), '');
    // opnieuw verzenden met een correctie: zelfde rij, formule terug
    const b = post({ actie: 'dagcontrole', soort: 'magazijn', datum: VANDAAG, afgeslotenOm: om.toISOString(), metingen: METINGEN, punten: magPunten() });
    assert.deepStrictEqual([b.rij, b.nieuw], [6, false]);
    assert.deepStrictEqual([mw(6, 'N'), mw(6, 'O'), mw(6, 'P'), mf(6, 'P')], [true, false, 'NVT', '=IF(N6;"NVT";)']);
    assert.strictEqual(mw(7, 'B'), '');
  });

  test('magazijn: geen voorbereide rijen meer, rij erbij zonder de invoer van de rij erboven' + naam, () => {
    const { fx, post } = opzetF();
    const mw = (r, l) => fx.mag.waarde(r, letterNaarKolom(l));
    [0, 1, 2, 3].forEach((n) => {
      const d = iso(dag(n));
      const a = post({ actie: 'dagcontrole', soort: 'magazijn', datum: d, afgeslotenOm: 'x', metingen: METINGEN, punten: magPunten(n === 2 ? { ok: 'E', tekst: 'pallet scheef' } : null) });
      assert.deepStrictEqual([a.ok, a.rij], [true, 6 + n], d);
    });
    assert.strictEqual(fx.mag.getMaxRows(), 9);
    assert.deepStrictEqual([mw(9, 'E'), mw(9, 'F'), mw(9, 'G'), mw(9, 'B')], [true, false, 'NVT', 21.5]);
    assert.strictEqual(mw(8, 'G'), 'pallet scheef');
  });

  test('dagcontrole: onbekend punt, ontbrekende opmerking of meting worden geweigerd en er wordt niets geschreven' + naam, () => {
    const { fx, post } = opzetF();
    const voor = JSON.stringify([...fx.mag.cellen].map(([k, x]) => [k, String(x.v), x.f]));
    const basis = { actie: 'dagcontrole', soort: 'magazijn', datum: VANDAAG, afgeslotenOm: 'x', metingen: METINGEN };
    assert.strictEqual(post({ ...basis, punten: [{ kop: 'Bestaat niet', ok: true }] }).code, 'INDELING');
    assert.strictEqual(post({ ...basis, punten: magPunten({ ok: 'E', tekst: '  ' }) }).code, 'VERZOEK');
    assert.strictEqual(post({ ...basis, metingen: [{ kop: METINGEN[0].kop, waarde: 'warm' }], punten: magPunten() }).code, 'VERZOEK');
    assert.strictEqual(post({ ...basis, soort: 'kelder', punten: magPunten() }).code, 'VERZOEK');
    assert.strictEqual(post({ ...basis, punten: [{ kop: MAGAZIJN_PUNTEN[2].kop, ok: true }] }).code, 'INDELING', 'een punt zonder selectievakjes kan niet ingevuld worden');
    assert.strictEqual(JSON.stringify([...fx.mag.cellen].map(([k, x]) => [k, String(x.v), x.f])), voor);
  });
}

test('ongeldige verzoeken worden geweigerd', () => {
  const { post } = opzet();
  assert.strictEqual(post({ actie: 'controle', appId: 'abc', ...BOVEN }).code, 'VERZOEK');
  assert.strictEqual(post({ actie: 'controle', appId: ID1, ...BOVEN, deel: 'midden' }).code, 'VERZOEK');
  assert.strictEqual(post({ actie: 'controle', appId: ID1, ...BOVEN, datum: '2/10/2026' }).code, 'VERZOEK');
  assert.strictEqual(post({ actie: 'controle', appId: ID1, ...BOVEN, code: '' }).code, 'VERZOEK');
  assert.strictEqual(post({ actie: 'wissen' }).code, 'ACTIE');
});

test('nakijken() schrijft niets', () => {
  const { script, fx } = opzet();
  const voor = JSON.stringify([...fx.tab.cellen].map(([k, x]) => [k, x.v instanceof Date ? x.v.getTime() : x.v, x.f]));
  script.roep('nakijken');
  const na = JSON.stringify([...fx.tab.cellen].map(([k, x]) => [k, x.v instanceof Date ? x.v.getTime() : x.v, x.f]));
  assert.strictEqual(na, voor);
  assert.ok(script.logboek.some((l) => /Orders: 5 \(rechtstreeks\), pallets: 4 \(rechtstreeks\)/.test(l)));
});

console.log(`\n${geslaagd} geslaagd, ${fouten.length} mislukt`);
if (fouten.length) { console.log('Mislukt: ' + fouten.join('; ')); process.exit(1); }
