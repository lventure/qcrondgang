// Test van apps-script/Code.gs tegen de nagebootste sheet. Uitvoeren: node test/script.test.cjs
const assert = require('assert');
const { laadScript, letterNaarKolom } = require('./nep-apps-script.cjs');
const { maakFixture, FORMULE_KOLOMMEN } = require('./fixture.cjs');

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

test('installeer voegt 10 kolommen toe vanaf AY en maakt een sleutel', () => {
  const { fx, sleutel, script } = opzet();
  assert.strictEqual(fx.tab.getMaxColumns(), 60);
  assert.strictEqual(fx.tab.cel(2, 51).v, 'App-ID');
  assert.strictEqual(fx.tab.cel(2, 60).v, 'Gezien: allergenen (boven)');
  assert.ok(/^[0-9a-f]{64}$/.test(sleutel));
  script.roep('installeer'); // tweede keer: niets erbij, zelfde sleutel
  assert.strictEqual(fx.tab.getMaxColumns(), 60);
  assert.strictEqual(script.props.SLEUTEL, sleutel);
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
