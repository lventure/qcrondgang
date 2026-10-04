// Test van de app in een echte browser (Chromium) tegen het echte Code.gs op een
// nagebootste sheet. Volgt hoofdstuk 11 van het bouwplan, voor zover het over
// de app gaat (fase 1 tot 3). Uitvoeren: node test/app.test.cjs
const assert = require('assert');
// Eenmalig: npm install playwright && npx playwright install chromium
const { chromium } = require(process.env.PLAYWRIGHT_PAD || 'playwright');
const { start } = require('./server.cjs');
const { letterNaarKolom } = require('./nep-apps-script.cjs');
const { OPERATOREN, OK3, OK4, JA_NEE, TRECHTERS, WERK_KOPPEN, MAGAZIJN_PUNTEN, dag, iso } = require('./fixture.cjs');

let srv;
let browser;
const uitslag = [];

const w = (r, l) => srv.staat.fx.tab.waarde(r, letterNaarKolom(l));
const formule = (r, l) => (srv.staat.fx.tab.cel(r, letterNaarKolom(l)) || {}).f || '';
const acties = (naam) => srv.staat.verzoeken.filter((v) => v.actie === naam).length;

async function context() {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 1180 }, hasTouch: true, locale: 'nl-BE', timezoneId: 'Europe/Brussels' });
  // Background Sync staat alleen aan in het scenario dat het test. De nagebootste
  // vliegtuigmodus van de testbrowser geldt niet altijd voor de service worker,
  // die dan toch zou verzenden; op een echte tablet zonder verbinding kan dat niet.
  await ctx.grantPermissions(['camera'], { origin: new URL(srv.appUrl).origin });
  ctx.fouten = [];
  return ctx;
}
async function pagina(ctx, { wachtOpSw = true } = {}) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => ctx.fouten.push(e.message));
  await page.goto(srv.appUrl);
  if (wachtOpSw) await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  return page;
}
async function stelIn(page) {
  await page.fill('#inst-url', srv.scriptUrl);
  await page.fill('#inst-sleutel', srv.staat.sleutel);
  await page.click('#inst-opslaan');
  await page.waitForSelector('#tegel-controles');
}
async function begin(page, code, deel, { tab } = {}) {
  await page.goto(srv.appUrl + '#/nieuw');
  await page.waitForSelector('#zoek');
  if (tab === 'pallet') await page.click('#tab-pallets');
  await page.fill('#zoek', code);
  await page.click(`#zoek-lijst .rij[data-code="${code}"]`);
  await page.click(`#start-${deel}`);
  await page.waitForSelector('#verder');
}
/** Kiest de operatoren in het keuzescherm: namen aantikken; eigen = namen die niet in de lijst staan en getypt worden. */
async function kiesOperatoren(page, namen, eigen = []) {
  await page.click('#operatoren-kies');
  await page.waitForSelector('#operatoren-kiezer');
  for (const n of namen) {
    await page.click(`#operatoren-lijst button[data-naam="${n}"]`);
    await page.waitForSelector(`#operatoren-lijst button[data-naam="${n}"].gekozen`);
  }
  for (const n of eigen) {
    await page.fill('#operator-nieuw', n);
    await page.click('#operator-toevoegen');
    await page.waitForFunction((naam) => [...document.querySelectorAll('#operatoren-lijst button.gekozen')].some((b) => b.dataset.naam === naam), n.replace(/,/g, ' ').replace(/\s+/g, ' ').trim());
  }
  await page.click('#operatoren-klaar');
  await page.waitForSelector('#operatoren-kiezer', { state: 'detached' });
  // het scherm eronder is opnieuw getekend met de gekozen namen
  const verwacht = [...namen, ...eigen.map((n) => n.replace(/,/g, ' ').replace(/\s+/g, ' ').trim())];
  await page.waitForFunction((v) => { const e = document.querySelector('#operatoren-tekst'); return e && v.every((n) => e.textContent.split(', ').includes(n)); }, verwacht);
}
const operatorenTekst = async (page) => ((await bestaat(page, '#operatoren-tekst')) ? page.textContent('#operatoren-tekst') : null);
/** Kiest een antwoord: een knop, of bij een lange keuzelijst (trechter) een keuze uit de uitklaplijst. '' = de uitdrukkelijke lege keuze. */
async function kies(page, veld, waarde) {
  const lijst = `section[data-veld="${veld}"] select.kies`;
  if (await bestaat(page, lijst)) {
    const teksten = await page.$$eval(lijst + ' option', (os) => os.map((o) => o.textContent));
    const i = waarde === '' ? teksten.length - 1 : teksten.indexOf(String(waarde));
    assert.ok(i > 0, `keuze "${waarde}" bestaat niet voor ${veld}: ${teksten.join(' / ')}`);
    await page.selectOption(lijst, { index: i });
    await page.waitForSelector(lijst + '.gekozen');
    await page.waitForFunction(([s, t]) => { const e = document.querySelector(s); return e && e.selectedOptions[0] && e.selectedOptions[0].textContent === t; }, [lijst, teksten[i]]);
    return;
  }
  const sel = `section[data-veld="${veld}"] button[data-waarde="${waarde}"]`;
  await page.click(sel);
  await page.waitForSelector(sel + '.gekozen');
}
/** Het gekozen antwoord van een punt zoals het op het scherm staat (tekst van de knop of van de lijst), of null. */
const gekozen = (page, veld) => page.evaluate((v) => {
  const s = document.querySelector(`section[data-veld="${v}"]`);
  const lijst = s.querySelector('select.kies');
  if (lijst) return lijst.value === '' ? null : lijst.selectedOptions[0].textContent;
  const knop = s.querySelector('button.keuze.gekozen');
  return knop ? knop.textContent : null;
}, veld);
async function verder(page) {
  const voor = await page.evaluate(() => location.hash);
  await page.click('#verder');
  await page.waitForFunction((h) => location.hash !== h, voor);
}
async function vulBoven(page, { trechter = '7', orde = 'OK', opm } = {}) {
  await kies(page, 'grdCorrect', 'true');
  await kies(page, 'allergeenEtiket', 'true');
  await kies(page, 'trechter', trechter);
  await kies(page, 'ordeNetheid', orde);
  if (opm) await page.fill('[data-invoer="opmBoven"]', opm);
  await verder(page);
  await page.waitForSelector('#open-boven');
}
const FOTOPUNT = { zk: 'fotoZk', etiket: 'fotoEtiket', opmerking: 'fotoOpmerking' };
async function neemFoto(page, soort) {
  const beeld = `section[data-veld="${FOTOPUNT[soort]}"][data-foto="ja"] img.foto-klein`;
  const vorige = await page.evaluate((s) => { const e = document.querySelector(s); return e ? e.src : null; }, beeld);
  await page.click(`#foto-${soort}`);
  await page.waitForSelector('#camera-knip:not([disabled])');
  await page.click('#camera-knip');
  await page.waitForSelector('#camera', { state: 'detached' });
  // de nieuwe foto staat op het scherm (bij opnieuw nemen: een andere dan daarnet)
  await page.waitForFunction(([s, v]) => { const e = document.querySelector(s); return e && e.src !== v; }, [beeld, vorige]);
}
async function vulFotos(page, { etiket = 'nvt' } = {}) {
  await neemFoto(page, 'zk');
  if (etiket === 'foto') await neemFoto(page, 'etiket');
  else { await page.click('#foto-etiket-nvt'); await page.waitForSelector('section[data-veld="fotoEtiket"][data-foto="nvt"]'); }
}
/** Vult alle punten op het huidige scherm van een dagcontrole met OK, behalve de opgegeven afwijkingen. */
async function vulDagScherm(page, afwijkingen = {}) {
  const koppen = await page.$$eval('section[data-punt]', (els) => els.map((e) => e.dataset.punt));
  for (const kop of koppen) {
    const sel = `section[data-punt="${kop}"]`;
    if (afwijkingen[kop] === undefined) {
      await page.click(`${sel} button[data-waarde="ok"]`);
      await page.waitForSelector(`${sel} button[data-waarde="ok"].gekozen`);
    } else {
      await page.click(`${sel} button[data-waarde="anders"]`);
      await page.waitForSelector(`${sel} textarea`);
      if (afwijkingen[kop]) await page.fill(`${sel} textarea`, afwijkingen[kop]);
    }
  }
  return koppen;
}
/** Vult alle punten van Beneden in (één scherm), zonder af te sluiten. fotos: false laat de foto's open. */
async function vulBenedenPunten(page, { checkweger = 'NEE', md = 'NEE', snelheid = '52', operator = 'AB', etiket = 'nvt', fotos = true } = {}) {
  await kies(page, 'lotZkCorrect', 'true');
  await kies(page, 'allergenenCorrect', 'true');
  await kiesOperatoren(page, [operator]);
  await kies(page, 'checkweger', checkweger);
  if (checkweger === 'JA') for (const v of ['cwGewicht', 'cwPlus', 'cwMin']) await kies(page, v, 'OK');
  await kies(page, 'metaaldetector', md);
  if (md === 'JA') await kies(page, 'mdUitworp', 'OK');
  await kies(page, 'monoDuo', '2');
  await page.fill('[data-invoer="snelheid"]', snelheid);
  for (const v of ['cProduct', 'cHoudbaarheid', 'cGewicht', 'cZk', 'cDi', 'cDs', 'cEtiket', 'cDocumenten', 'cAllergenen']) await kies(page, v, 'OK');
  if (fotos) await vulFotos(page, { etiket });
}
async function vulBeneden(page, opties = {}) {
  await vulBenedenPunten(page, opties);
  await verder(page);
  await page.waitForSelector('#open-beneden');
}
// Nooit een ElementHandle in een assert: bij een mislukking probeert Node het hele object uit te schrijven.
const bestaat = async (page, sel) => (await page.$(sel)) !== null;
async function wachtOpTekst(page, re, timeout = 20000) {
  await page.waitForFunction((bron) => new RegExp(bron).test((document.querySelector('#wachtrij-tekst') || {}).textContent || ''), re.source, { timeout });
}
/** Wacht tot fn() waar is (nakijken in de nagebootste sheet). */
async function tot(fn, wat, timeout = 15000) {
  const einde = Date.now() + timeout;
  while (!fn()) {
    if (Date.now() > einde) throw new Error('Niet gebeurd binnen ' + timeout + ' ms: ' + wat);
    await new Promise((r) => setTimeout(r, 50));
  }
}
/**
 * Wacht tot de wachtrij op de tablet echt leeg is en de balk dat ook zegt. Alleen
 * naar de balk kijken is niet genoeg: vlak na het afsluiten staat er nog even
 * "Alles verzonden" van daarvoor.
 */
async function allesVerzonden(page, timeout = 20000) {
  await page.waitForFunction(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('qc-rondgang'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    try {
      return (await new Promise((res) => { const q = db.transaction('wachtrij').objectStore('wachtrij').count(); q.onsuccess = () => res(q.result); })) === 0;
    } finally { db.close(); }
  }, null, { timeout, polling: 100 });
  await wachtOpTekst(page, /^Alles verzonden/, timeout);
}
/** Leest of wijzigt de opslag van de app rechtstreeks (IndexedDB), in de pagina. */
const opslag = (page, fn, arg) => page.evaluate(async ({ bron, arg }) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('qc-rondgang'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const vraag = (q) => new Promise((res, rej) => { q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  try { return await (new Function('db', 'vraag', 'arg', `return (${bron})(db, vraag, arg);`))(db, vraag, arg); } finally { db.close(); }
}, { bron: fn.toString(), arg });
/** De keuzes van een punt zoals ze op het scherm staan: de knoppen, of de regels van de uitklaplijst (zonder "Kies…"). */
const knoppen = (page, veld) => page.evaluate((v) => {
  const s = document.querySelector(`section[data-veld="${v}"]`);
  const lijst = s.querySelector('select.kies');
  return lijst ? [...lijst.options].slice(1).map((o) => o.textContent) : [...s.querySelectorAll('button.keuze')].map((b) => b.textContent);
}, veld);
const chip = (page, code, deel) => page.getAttribute(`.rij[data-code="${code}"] .chip[data-deel="${deel}"]`, 'data-status');

async function scenario(naam, fn) {
  if (process.env.ALLEEN && !new RegExp(process.env.ALLEEN).test(naam)) return;
  srv.staat.reset();
  const ctx = await context();
  const t0 = Date.now();
  try {
    await fn(ctx);
    assert.deepStrictEqual(ctx.fouten, [], 'JavaScript-fouten op de pagina');
    uitslag.push({ naam, ok: true });
    console.log(`  ok   ${naam} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    uitslag.push({ naam, ok: false });
    console.log(`  FOUT ${naam}\n       ${String(e.message).split('\n').slice(0, 12).join('\n       ')}`);
    try { const p = ctx.pages()[0]; if (p) await p.screenshot({ path: `${process.env.SCHERM_MAP || '.'}/fout-${uitslag.length}.png`, fullPage: true }); } catch (x) { /* geen scherm */ }
  } finally {
    await ctx.close();
  }
}

(async () => {
  srv = await start();
  // Het volledige Chromium (niet de headless shell): alleen dat kent Background Sync.
  // De twee vlaggen geven Chromium een nagebootste camera, zonder vraag om toestemming.
  browser = await chromium.launch({ channel: 'chromium', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  console.log('App in Chromium tegen Code.gs op de nagebootste sheet');

  await scenario('zonder sleutel alleen het instelscherm; verkeerde sleutel geweigerd; geen preflight', async (ctx) => {
    const page = await pagina(ctx);
    await page.waitForSelector('#inst-opslaan');
    assert.strictEqual(await bestaat(page, '#tegel-controles'), false);
    assert.strictEqual(await bestaat(page, '#ververs'), false);
    await page.goto(srv.appUrl + '#/controles');
    await page.waitForSelector('#inst-opslaan');
    assert.strictEqual(await bestaat(page, '#nieuwe-controle'), false, 'ook via een rechtstreekse link alleen het instelscherm');
    await page.fill('#inst-url', srv.scriptUrl);
    await page.fill('#inst-sleutel', 'verkeerd');
    await page.click('#inst-opslaan');
    await page.waitForSelector('#inst-fout');
    assert.match(await page.textContent('#inst-fout'), /Sleutel geweigerd/);
    assert.strictEqual(acties('snapshot'), 0);
    await stelIn(page);
    assert.match(await page.textContent('#gegevens'), /Gegevens van \d\d:\d\d/);
    assert.strictEqual(srv.staat.preflights, 0);
    assert.ok(srv.staat.verzoeken.every((v) => v.type === 'text/plain;charset=utf-8'));
    const bron = await page.content();
    assert.ok(!bron.includes(srv.staat.sleutel), 'de sleutel staat niet in de pagina');
  });

  await scenario('knoppen zijn exact de keuzelijst van de sheet; niets vooraf ingevuld', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await begin(page, '260102', 'boven');
    assert.strictEqual(await bestaat(page, '#deel section[data-veld] .gekozen'), false, 'geen enkel antwoord vooraf ingevuld');
    assert.strictEqual(await page.inputValue('#lijn'), 'L8', 'alleen de lijn staat er al, uit de productielijst');
    assert.deepStrictEqual(await knoppen(page, 'grdCorrect'), ['Ja', 'Nee']);
    assert.deepStrictEqual(await knoppen(page, 'trechter'), [...TRECHTERS, 'Geen trechter of mes']);
    assert.deepStrictEqual(await knoppen(page, 'ordeNetheid'), OK4);
    assert.strictEqual(await page.inputValue('[data-invoer="opmBoven"]'), '');
    await page.goto(srv.appUrl + '#/controles');
    await page.click('.rij[data-code="260102"]');
    await page.click('#open-beneden');
    await page.waitForSelector('#verder');
    assert.strictEqual(await bestaat(page, '#deel section[data-veld] .gekozen'), false, 'geen enkel antwoord vooraf ingevuld');
    assert.strictEqual(await page.inputValue('#lijn'), 'L8', 'alleen de lijn staat er al, uit de productielijst');
    // alle punten van Beneden staan samen op één scherm
    assert.deepStrictEqual(await page.$$eval('#deel section[data-veld]', (els) => els.map((e) => e.dataset.veld)),
      ['lotZkCorrect', 'allergenenCorrect', 'operatoren', 'checkweger', 'cwGewicht', 'cwPlus', 'cwMin', 'metaaldetector', 'mdUitworp', 'monoDuo', 'snelheid',
        'cProduct', 'cHoudbaarheid', 'cGewicht', 'cZk', 'cDi', 'cDs', 'cEtiket', 'cDocumenten', 'cAllergenen', 'opmBeneden', 'fotoZk', 'fotoEtiket', 'fotoOpmerking']);
    // Mono/Duo en Snelheid staan in één blok, direct onder elkaar
    assert.deepStrictEqual(await page.$$eval('#deel .samen section[data-veld]', (els) => els.map((e) => e.dataset.veld)), ['monoDuo', 'snelheid']);
    // operatoren: het keuzescherm toont exact de lijst van de sheet, niemand vooraf gekozen
    assert.strictEqual(await operatorenTekst(page), null);
    await page.click('#operatoren-kies');
    await page.waitForSelector('#operatoren-kiezer');
    assert.deepStrictEqual(await page.$$eval('#operatoren-lijst button', (bs) => bs.map((b) => b.dataset.naam)), OPERATOREN);
    assert.strictEqual(await bestaat(page, '#operatoren-lijst .gekozen'), false);
    await page.click('#operatoren-klaar');
    await page.waitForSelector('#operatoren-kiezer', { state: 'detached' });
    assert.deepStrictEqual(await knoppen(page, 'checkweger'), JA_NEE);
    assert.deepStrictEqual(await knoppen(page, 'cwGewicht'), OK3);
    assert.deepStrictEqual(await knoppen(page, 'metaaldetector'), JA_NEE);
    assert.deepStrictEqual(await knoppen(page, 'mdUitworp'), OK3);
    assert.deepStrictEqual(await knoppen(page, 'monoDuo'), ['1', '2']);
    assert.strictEqual(await page.inputValue('[data-invoer="snelheid"]'), '');
    for (const v of ['cProduct', 'cHoudbaarheid', 'cGewicht', 'cZk', 'cDi', 'cDs', 'cEtiket', 'cDocumenten', 'cAllergenen']) assert.deepStrictEqual(await knoppen(page, v), OK4);
    await kiesOperatoren(page, ['CD', 'Interim/Flexi']);
    assert.strictEqual(await operatorenTekst(page), 'CD, Interim/Flexi');
  });

  for (const [naam, maat] of [['liggend (1280 × 720)', { width: 1280, height: 720 }], ['staand (800 × 1180)', { width: 800, height: 1180 }]]) {
    await scenario(`tablet van 12 duim ${naam}: Boven en Beneden passen elk op één scherm, ook met open punten en ingevuld`, async (ctx) => {
      const page = await pagina(ctx);
      await page.setViewportSize(maat);
      await stelIn(page);
      const past = async (wat) => {
        const m = await page.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight, document.documentElement.scrollWidth, window.innerWidth]);
        assert.ok(m[0] <= m[1] && m[2] <= m[3], `${wat}: inhoud ${m[2]} × ${m[0]} op een scherm van ${m[3]} × ${m[1]}`);
        // elke knop is groot genoeg om aan te tikken
        const klein = await page.$$eval('#deel button, #deel select, #deel input', (els) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.height < 44 || r.width < 44).length);
        assert.strictEqual(klein, 0, `${wat}: knoppen kleiner dan 44 punten`);
      };
      await begin(page, '260102', 'boven');
      await past('Boven leeg');
      await page.click('#verder');
      await page.waitForSelector('#open-melding');
      await past('Boven met open punten');
      await vulBoven(page, { opm: 'zeef vervangen voor de start' });
      await page.click('#open-beneden');
      await page.waitForSelector('#verder');
      await past('Beneden leeg');
      await page.click('#verder');
      await page.waitForSelector('#open-melding');
      await past('Beneden met open punten');
      await vulBenedenPunten(page, { checkweger: 'JA', md: 'JA', etiket: 'foto' });
      await kies(page, 'cAllergenen', 'NOK');
      await page.fill('[data-invoer="opmBeneden"]', 'schroevendraaier lag op de lijn');
      await past('Beneden ingevuld');
      await verder(page);
      await allesVerzonden(page, 30000);
      assert.deepStrictEqual([w(5, 'AJ'), w(5, 'AA'), w(5, 'AK'), w(5, 'AL')], ['NOK', 'schroevendraaier lag op de lijn', 'Foto ZK', 'Foto etiket']);
    });
  }

  await scenario('een deel afsluiten met een open punt: de app weigert en toont welk punt', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await begin(page, '260102', 'boven');
    const hash = await page.evaluate(() => location.hash);
    await page.click('#verder');
    await page.waitForSelector('#open-melding');
    assert.deepStrictEqual(await page.$$eval('.punt.open', (els) => els.map((e) => e.dataset.veld)), ['grdCorrect', 'allergeenEtiket', 'trechter', 'ordeNetheid']);
    await kies(page, 'grdCorrect', 'true'); await kies(page, 'allergeenEtiket', 'true'); await kies(page, 'trechter', '');
    assert.deepStrictEqual(await page.$$eval('.punt.open', (els) => els.map((e) => e.dataset.veld)), ['ordeNetheid']);
    await kies(page, 'ordeNetheid', 'STOP');
    await page.click('#verder');
    await page.waitForSelector('.punt.open[data-veld="opmBoven"]');
    assert.match(await page.textContent('#open-melding'), /NOK of STOP vraagt een opmerking/);
    assert.strictEqual(await page.evaluate(() => location.hash), hash, 'nog op hetzelfde scherm');
    assert.strictEqual(acties('controle'), 0);
    await page.fill('[data-invoer="opmBoven"]', 'Spillage naast de trechter, lijn stilgelegd');
    await verder(page);
    await allesVerzonden(page);
    assert.strictEqual(w(5, 'AT'), 'STOP');
    assert.strictEqual(w(5, 'AS'), '', 'Geen trechter of mes = lege cel');
    assert.strictEqual(w(5, 'AU'), 'Spillage naast de trechter, lijn stilgelegd');
  });

  await scenario('vliegtuigmodus: Boven voor drie lijnen, app sluiten en heropenen, Beneden toont Boven; daarna alles één keer in de sheet', async (ctx) => {
    let page = await pagina(ctx);
    await stelIn(page);
    await ctx.setOffline(true);
    const codes = ['260101', '260102', '260103'];
    for (const [i, code] of codes.entries()) { await begin(page, code, 'boven'); await vulBoven(page, { trechter: String(i + 3) }); }
    await wachtOpTekst(page, /^3 controles wachten/);
    assert.strictEqual(w(5, 'I'), '', 'nog niets in de sheet');
    await page.close();

    page = await pagina(ctx); // heropenen zonder verbinding: de service worker levert de app
    await page.waitForSelector('#tegel-controles');
    await wachtOpTekst(page, /^3 controles wachten · geen verbinding$/);
    for (const [i, code] of codes.entries()) {
      await page.goto(srv.appUrl + '#/controles');
      await page.waitForSelector(`.rij[data-code="${code}"]`);
      assert.strictEqual(await chip(page, code, 'boven'), 'klaar');
      assert.strictEqual(await chip(page, code, 'beneden'), 'open');
      await page.click(`.rij[data-code="${code}"]`);
      await page.click('#open-beneden');
      await page.waitForSelector('#blok-boven');
      const blok = await page.textContent('#blok-boven');
      assert.match(blok, /Boven: afgesloten om \d\d:\d\d/);
      assert.match(blok, new RegExp(`Trechter \\+ mes\\?${i + 3}`));
      assert.match(blok, /GRD correct\?Ja/);
      await vulBeneden(page);
      // het blok van Boven staat op elk scherm van Beneden; hier nagekeken op het eerste
    }
    await wachtOpTekst(page, /^3 controles en 3 foto's wachten/);
    assert.strictEqual(acties('controle'), 0);
    await page.reload();
    await page.waitForSelector('#kop-controle');
    await wachtOpTekst(page, /^3 controles en 3 foto's wachten/);

    await ctx.setOffline(false);
    await allesVerzonden(page);
    codes.forEach((code, i) => {
      const r = [5, 6, 7].find((x) => String(w(x, 'I')) === code);
      assert.ok(r, `rij voor ${code}`);
      assert.strictEqual(w(r, 'AS'), i + 3);
      assert.strictEqual(w(r, 'Q'), 'AB');
      assert.strictEqual(w(r, 'T'), 'NVT');
      assert.strictEqual(w(r, 'Z'), 52);
    });
    assert.strictEqual(srv.staat.fx.tab.getMaxRows(), 7, 'geen vierde rij');
    assert.strictEqual(acties('controle'), 6);
    assert.strictEqual(srv.staat.script.drive.alleBestanden().length, 3, 'drie foto\'s in Drive');
    assert.deepStrictEqual([5, 6, 7].map((r) => [w(r, 'AK'), w(r, 'AL')]), [['Foto ZK', ''], ['Foto ZK', ''], ['Foto ZK', '']]);
    await page.goto(srv.appUrl + '#/einde');
    await page.waitForSelector('#eind[data-groen="true"]');
  });

  await scenario('Boven met verbinding verzonden, Beneden later: zelfde rij, niets van Boven gewist', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await begin(page, '260102', 'boven');
    await vulBoven(page, { trechter: '9', opm: 'trechter 9 proper' });
    await allesVerzonden(page);
    await page.waitForSelector('.chip[data-deel="boven"][data-status="verzonden"]');
    assert.strictEqual(w(5, 'I'), 260102);
    assert.strictEqual(w(5, 'AS'), 9);
    assert.strictEqual(w(5, 'Q'), '');
    assert.strictEqual(await bestaat(page, '#verwijder'), false, 'een verzonden controle kan niet meer verwijderd worden');
    await page.click('#open-beneden');
    await page.waitForSelector('#verder');
    await vulBeneden(page, { checkweger: 'JA', md: 'JA', snelheid: '61' });
    await allesVerzonden(page);
    assert.strictEqual(w(5, 'AS'), 9);
    assert.strictEqual(w(5, 'AU'), 'trechter 9 proper');
    assert.strictEqual(w(5, 'AP'), true);
    assert.deepStrictEqual(['S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'].map((l) => w(5, l)), ['JA', 'OK', 'OK', 'OK', 'JA', 'OK', 2, 61]);
    assert.strictEqual(w(6, 'I'), '');
    assert.deepStrictEqual([w(5, 'BC'), w(5, 'BD'), w(5, 'BE'), w(5, 'BF'), w(5, 'BG'), w(5, 'BH')],
      ['Voorbeeld Proteïne 100ge', 'LOT: 2600000102', 'melk - soja', 'Proteïnepoeder D', '444444', 'melk - soja']);
  });

  await scenario('bevestiging gaat verloren tijdens het verzenden: geen dubbele rij', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    srv.staat.verlies = 1;
    await begin(page, '260103', 'boven');
    await vulBoven(page);
    await wachtOpTekst(page, /^1 controle wacht · geen verbinding$/);
    assert.strictEqual(w(5, 'I'), 260103, 'de sheet had het verzoek al verwerkt');
    assert.strictEqual(await page.getAttribute('.chip[data-deel="boven"]', 'data-status'), 'klaar', 'nog niet als verzonden gemarkeerd');
    await allesVerzonden(page, 15000); // tweede poging na 5 s
    assert.strictEqual(acties('controle'), 2);
    assert.strictEqual(w(6, 'I'), '');
    assert.strictEqual(w(6, 'AY'), '');
  });

  await scenario('script antwoordt met een foutpagina: item blijft in de wachtrij en gaat later door', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    srv.staat.html = 1;
    await begin(page, '260103', 'boven');
    await vulBoven(page);
    await wachtOpTekst(page, /1 controle wacht.*Fout: Onverwacht antwoord/);
    assert.strictEqual(w(5, 'I'), '');
    await page.click('#nu-sync');
    await allesVerzonden(page);
    assert.strictEqual(w(5, 'I'), 260103);
  });

  await scenario('herladen midden in een deel: elk veld was al bewaard', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await begin(page, '260104', 'beneden');
    await kies(page, 'lotZkCorrect', 'true'); await kies(page, 'allergenenCorrect', 'true'); await kiesOperatoren(page, ['GH']);
    await kies(page, 'checkweger', 'NEE');
    await kies(page, 'metaaldetector', 'JA');
    await page.fill('[data-invoer="snelheid"]', '47');
    await page.reload();
    await page.waitForSelector('section[data-veld="metaaldetector"] button[data-waarde="JA"].gekozen');
    assert.strictEqual(await page.inputValue('[data-invoer="snelheid"]'), '47');
    assert.strictEqual(await bestaat(page, 'section[data-veld="mdUitworp"] .gekozen'), false);
    await page.waitForSelector('section[data-veld="checkweger"] button[data-waarde="NEE"].gekozen');
    assert.strictEqual(await operatorenTekst(page), 'GH');
    await page.goto(srv.appUrl + '#/controles');
    await page.waitForSelector('.rij[data-code="260104"]');
    assert.strictEqual(await chip(page, '260104', 'beneden'), 'bezig');
  });

  await scenario('Checkweger en Metaaldetector: automatische NVT in de app en de formule in de sheet', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await begin(page, '260102', 'beneden');
    await kies(page, 'lotZkCorrect', 'true'); await kies(page, 'allergenenCorrect', 'true'); await kiesOperatoren(page, ['AB']);
    // JA: de drie punten moeten beantwoord worden
    await kies(page, 'checkweger', 'JA');
    await page.click('#verder');
    await page.waitForSelector('#open-melding');
    assert.deepStrictEqual(await page.$$eval('.punt.open', (els) => els.map((e) => e.dataset.veld).filter((v) => v.startsWith('cw'))), ['cwGewicht', 'cwPlus', 'cwMin']);
    await kies(page, 'cwGewicht', 'OK'); await kies(page, 'cwPlus', 'NOK'); await kies(page, 'cwMin', 'OK');
    // NEE: antwoorden gewist, vergrendeld op NVT (automatisch), zichtbaar
    await kies(page, 'checkweger', 'NEE');
    assert.strictEqual(await page.$$eval('.punt.vervallen', (els) => els.length), 3);
    assert.strictEqual(await bestaat(page, 'section[data-veld="cwPlus"] button'), false, 'vergrendeld');
    assert.match(await page.textContent('section[data-veld="cwPlus"]'), /NVT \(automatisch\)/);
    // terug naar JA: open en leeg
    await kies(page, 'checkweger', 'JA');
    assert.strictEqual(await bestaat(page, 'section[data-veld="cwPlus"] .gekozen'), false);
    for (const v of ['cwGewicht', 'cwPlus', 'cwMin']) await kies(page, v, 'OK');
    // Metaaldetector blijft een vraag, ook los van Checkweger
    assert.strictEqual(await bestaat(page, 'section[data-veld="metaaldetector"].vervallen'), false);
    await kies(page, 'metaaldetector', 'NEE');
    assert.match(await page.textContent('section[data-veld="mdUitworp"]'), /NVT \(automatisch\)/);
    await kies(page, 'monoDuo', '1'); await page.fill('[data-invoer="snelheid"]', '38');
    for (const v of ['cProduct', 'cHoudbaarheid', 'cGewicht', 'cZk', 'cDi', 'cDs', 'cEtiket', 'cDocumenten', 'cAllergenen']) await kies(page, v, 'OK');
    await vulFotos(page);
    await verder(page);
    await allesVerzonden(page);
    assert.deepStrictEqual(['T', 'U', 'V'].map((l) => [w(5, l), formule(5, l)]), [['OK', ''], ['OK', ''], ['OK', '']]);
    assert.deepStrictEqual([w(5, 'X'), formule(5, 'X')], ['NVT', '=if(W5="nee";"NVT";)']);

    // Corrigeren naar NEE: de formule staat er weer
    await page.click('#open-beneden');
    await page.click('#corrigeren');
    await page.waitForSelector('#verder');
    await kies(page, 'checkweger', 'NEE');
    await page.waitForSelector('section[data-veld="fotoZk"][data-foto="ja"]'); // de foto van daarnet staat er nog
    await verder(page);
    await page.waitForSelector('#open-beneden');
    await allesVerzonden(page);
    assert.deepStrictEqual(['T', 'U', 'V'].map((l) => [w(5, l), formule(5, l)]), [['NVT', '=IF(S5="nee";"NVT";)'], ['NVT', '=IF(S5="nee";"NVT";)'], ['NVT', '=IF(S5="nee";"NVT";)']]);
    assert.strictEqual(w(5, 'S'), 'NEE');
    assert.strictEqual(w(6, 'I'), '', 'correctie komt in dezelfde rij');
  });

  await scenario('verversen midden in de rondgang: invoer en wachtrij blijven, lijst is bijgewerkt, verschil wordt getoond', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    // open controle met een paar antwoorden
    await begin(page, '260102', 'boven');
    await kies(page, 'grdCorrect', 'true'); await kies(page, 'trechter', '4');
    await page.fill('[data-invoer="opmBoven"]', 'nog bezig');
    // volle wachtrij: de sheet is bezet, het script weigert tijdelijk
    srv.staat.script.slot.bezet = true;
    await begin(page, '260103', 'boven');
    await vulBoven(page);
    await wachtOpTekst(page, /1 controle wacht.*Fout: De sheet is bezet/);
    // intussen wijzigt de productielijst
    const p = srv.staat.fx.pTab;
    p.cel(6, 9).v = '444999';                 // LOT GRD van 260102
    p.cel(6, 12).v = 'melk - soja - gluten';  // Allergenen van 260102
    [10, 260108, 'In productie', 'Voorbeeld Nieuw 12g', 'L4', 12, 'g', 'Poeder N', '999999', '', 'LOT: 2600000108', ''].forEach((v, i) => { p.cel(12, i + 1, true).v = v; });
    await page.click('#ververs');
    await page.waitForFunction(() => /Gegevens ververst om \d\d:\d\d/.test((document.querySelector('#melding.ok') || {}).textContent || ''));
    await wachtOpTekst(page, /1 controle wacht/);
    // nieuwe order staat in de lijst
    await page.goto(srv.appUrl + '#/nieuw');
    await page.waitForSelector('#zoek-lijst .rij[data-code="260108"]');
    // de open controle: antwoorden onaangeroerd, verschil getoond
    await page.goto(srv.appUrl + '#/controles');
    await page.click('.rij[data-code="260102"]');
    await page.waitForSelector('#wijziging');
    const wijziging = await page.textContent('#wijziging');
    assert.match(wijziging, /LOT GRD444444 → 444999/);
    assert.match(wijziging, /Allergenenmelk - soja → melk - soja - gluten/);
    assert.ok(!/Product/.test(wijziging), 'alleen wat veranderd is');
    await page.click('#open-boven');
    await page.waitForSelector('section[data-veld="grdCorrect"] button[data-waarde="true"].gekozen');
    assert.strictEqual(await gekozen(page, 'trechter'), '4');
    assert.strictEqual(await page.inputValue('[data-invoer="opmBoven"]'), 'nog bezig');
    assert.strictEqual(await page.textContent('#kop-controle dd[data-opzoek="lotGrd"]'), '444999');
    // het afgesloten deel van de andere controle houdt wat toen gezien werd
    srv.staat.script.slot.bezet = false;
    await page.click('#nu-sync');
    await allesVerzonden(page);
    assert.strictEqual(w(5, 'I'), 260103);
    assert.strictEqual(w(5, 'BF'), 'Suiker E');
    // open controle afsluiten: Gezien = de nieuwe waarden
    await kies(page, 'allergeenEtiket', 'true'); await kies(page, 'ordeNetheid', 'OK');
    await verder(page);
    await allesVerzonden(page);
    assert.deepStrictEqual([w(6, 'I'), w(6, 'BG'), w(6, 'BH')], [260102, '444999', 'melk - soja - gluten']);
  });

  await scenario('verversen zonder verbinding: de oude gegevens blijven en de app meldt het', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    const gegevens = await page.textContent('#gegevens span');
    await ctx.setOffline(true);
    await page.click('#ververs');
    await page.waitForSelector('#melding.fout');
    assert.match(await page.textContent('#melding'), /Verversen mislukt, gegevens van \d\d:\d\d blijven in gebruik/);
    assert.strictEqual(await page.textContent('#gegevens span'), gegevens);
    await page.goto(srv.appUrl + '#/nieuw');
    await page.waitForSelector('#zoek-lijst .rij[data-code="260101"]');
    assert.strictEqual(await page.$$eval('#zoek-lijst .rij', (r) => r.length), 5);
    // een onvolledig antwoord van het script wordt ook nooit gebruikt
    await ctx.setOffline(false);
    srv.staat.fx.tab.cel(2, letterNaarKolom('S')).v = 'hernoemd';
    await page.click('#ververs');
    await page.waitForSelector('#melding.fout');
    assert.match(await page.textContent('#melding'), /Verversen mislukt.*checkweger/);
    assert.strictEqual(await page.$$eval('#zoek-lijst .rij', (r) => r.length), 5);
    // ... en een snapshot zonder keuzelijst evenmin
    srv.staat.fx.tab.cel(2, letterNaarKolom('S')).v = 'Checkweger?';
    [4, 5].forEach((r) => { srv.staat.fx.tab.cel(r, letterNaarKolom('AT')).dv = null; });
    const voor = await page.textContent('#gegevens span');
    await page.click('#ververs');
    await page.waitForFunction(() => /keuzelijst/.test((document.querySelector('#melding.fout') || {}).textContent || ''));
    assert.match(await page.textContent('#melding'), /ontbreekt de keuzelijst voor: Gesloten circuits/);
    assert.strictEqual(await page.textContent('#gegevens span'), voor);
  });

  await scenario('wat (mogelijk) al in de sheet staat, kan niet meer van de tablet verwijderd worden', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    // verzonden en daarna heropend voor correctie
    await begin(page, '260102', 'boven');
    await vulBoven(page);
    await allesVerzonden(page);
    await page.click('#open-boven');
    await page.click('#corrigeren');
    await page.waitForSelector('#verder');
    await page.click('#terug');
    await page.waitForSelector('#open-boven');
    assert.strictEqual(await page.getAttribute('.chip[data-deel="boven"]', 'data-status'), 'bezig');
    assert.strictEqual(await bestaat(page, '#verwijder'), false);
    // bevestiging verloren: de app weet niet of de rij er staat
    srv.staat.verlies = 1;
    await begin(page, '260103', 'boven');
    await vulBoven(page);
    await wachtOpTekst(page, /^1 controle wacht · geen verbinding$/);
    assert.strictEqual(await bestaat(page, '#verwijder'), false);
    // het eindscherm is niet groen zolang er iets wacht
    await page.goto(srv.appUrl + '#/einde');
    await page.waitForSelector('#eind');
    assert.strictEqual(await page.getAttribute('#eind', 'data-groen'), 'false');
    await page.waitForSelector('#eind[data-groen="true"]', { timeout: 15000 });
    assert.strictEqual(w(7, 'I'), '', 'twee controles, twee rijen');
  });

  await scenario('code die niet in de lijst staat: verversen of intypen; de rij komt in de sheet', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await page.goto(srv.appUrl + '#/nieuw');
    await page.fill('#zoek', '269999');
    await page.waitForSelector('#niet-gevonden');
    assert.ok(await page.$('#zoek-ververs'), 'het zoekscherm biedt verversen aan');
    await page.click('#code-intypen');
    await page.waitForSelector('#keuze-kaart');
    assert.match(await page.textContent('#keuze-kaart'), /staat niet in de opgehaalde gegevens/);
    await page.click('#start-boven');
    await page.waitForSelector('#verder');
    await vulBoven(page);
    await allesVerzonden(page);
    assert.strictEqual(w(5, 'I'), 269999);
    assert.deepStrictEqual([w(5, 'BF'), w(5, 'BG'), w(5, 'BH')], ['', '', '']);
    assert.strictEqual(formule(5, 'J'), '=FORMULE_J(I5)', 'de sheet vult product en lot zelf aan');
  });

  await scenario('pallet uit de poco list; dubbele controle wordt gemeld; onverzonden controle verwijderen', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await ctx.setOffline(true);
    await begin(page, '50001', 'boven', { tab: 'pallet' });
    assert.strictEqual(await page.textContent('dd[data-opzoek="grondstof"]'), 'KRUIDENMIX TACO 01');
    assert.strictEqual(await page.textContent('dd[data-opzoek="lotGrd"]'), '439001');
    await vulBoven(page);
    await page.goto(srv.appUrl + '#/nieuw');
    await page.click('#tab-pallets');
    await page.click('#zoek-lijst .rij[data-code="50001"]');
    await page.waitForSelector('#bestaat-al');
    await page.goto(srv.appUrl + '#/controles');
    await page.click('.rij[data-code="50001"]');
    await page.click('#verwijder');
    await page.click('#verwijder-ja');
    await page.waitForSelector('#nieuwe-controle');
    assert.strictEqual(await bestaat(page, '.rij[data-code="50001"]'), false);
    await ctx.setOffline(false);
    await allesVerzonden(page);
    await page.waitForTimeout(500);
    assert.strictEqual(acties('controle'), 0, 'een verwijderde controle wordt niet verzonden');
    assert.strictEqual(w(5, 'I'), '');
  });

  await scenario('corrigeren voor het verzenden: alleen de laatste versie gaat naar de sheet', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await ctx.setOffline(true);
    await begin(page, '260101', 'boven');
    await vulBoven(page, { trechter: '2' });
    await page.click('#open-boven');
    await page.click('#corrigeren');
    await page.waitForSelector('#verder');
    await wachtOpTekst(page, /^Alles verzonden/); // heropend: niets in de wachtrij
    await kies(page, 'trechter', '11');
    await ctx.setOffline(false);
    await page.waitForTimeout(800);
    assert.strictEqual(acties('controle'), 0, 'een heropend deel wordt niet verzonden');
    await verder(page);
    await allesVerzonden(page);
    assert.strictEqual(acties('controle'), 1);
    assert.strictEqual(w(5, 'AS'), 11);
  });

  await scenario('een andere app op dezelfde oorsprong wist de cache (Palletscan): de app herstelt zich en start weer zonder verbinding', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    const aantal = () => page.evaluate(async () => { const n = (await caches.keys()).find((k) => k.startsWith('qc-rondgang-')); return n ? (await (await caches.open(n)).keys()).length : 0; });
    assert.strictEqual(await aantal(), 13);
    // wat de service worker van Palletscan doet bij activeren: alle andere caches weg
    await page.evaluate(async () => { for (const k of await caches.keys()) await caches.delete(k); });
    assert.strictEqual(await aantal(), 0);
    await page.reload();
    await page.waitForSelector('#tegel-controles');
    for (let i = 0; i < 50 && (await aantal()) < 13; i++) await page.waitForTimeout(100);
    assert.strictEqual(await aantal(), 13, 'cache weer volledig');
    await page.goto(srv.appUrl + '#/instellingen');
    await page.waitForSelector('#inst-offline');
    assert.match(await page.textContent('#inst-offline'), /bewaard: ja \(13 bestanden\)/);
    await ctx.setOffline(true);
    await page.goto(srv.appUrl);
    await page.reload();
    await page.waitForSelector('#tegel-controles');
  });

  await scenario('nieuwe versie online: de app meldt het, schakelt pas over na Bijwerken en verliest geen invoer', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await begin(page, '260102', 'boven');
    await kies(page, 'grdCorrect', 'true');
    await page.fill('[data-invoer="opmBoven"]', 'voor de update');
    await page.goto(srv.appUrl + '#/instellingen');
    await page.waitForSelector('#inst-versie');
    const oud = await page.textContent('#inst-versie');
    assert.ok(!/9\.9\.9/.test(oud));
    await page.click('#zoek-versie');
    await page.waitForFunction(() => /nieuwste versie/.test(document.querySelector('#zoek-versie').textContent));
    // zonder de pagina te herladen: de app zoekt zelf en meldt de nieuwe versie
    srv.staat.nieuweVersie = '9.9.9';
    await page.click('#zoek-versie');
    await page.waitForFunction(() => /Er is een nieuwe versie/.test(document.querySelector('#balk').textContent), null, { timeout: 15000 });
    assert.strictEqual(await page.textContent('#inst-versie'), oud, 'nog niet overgeschakeld');
    await page.click('#balk >> text=Bijwerken');
    await page.waitForFunction(() => /9\.9\.9/.test((document.querySelector('#inst-versie') || {}).textContent || ''), null, { timeout: 15000 });
    await page.goto(srv.appUrl + '#/controles');
    await page.click('.rij[data-code="260102"]');
    await page.click('#open-boven');
    await page.waitForSelector('section[data-veld="grdCorrect"] button[data-waarde="true"].gekozen');
    assert.strictEqual(await page.inputValue('[data-invoer="opmBoven"]'), 'voor de update');
  });

  await scenario('foto\'s: verplicht om Beneden af te sluiten, offline bewaard, na herladen nog aanwezig, link in AK en AL', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await ctx.setOffline(true);
    await begin(page, '260102', 'beneden');
    await vulBenedenPunten(page, { snelheid: '50', fotos: false });
    // zonder foto's sluit Beneden niet af
    const hash = await page.evaluate(() => location.hash);
    await page.click('#verder');
    await page.waitForSelector('#open-melding');
    assert.deepStrictEqual(await page.$$eval('.punt.open', (els) => els.map((e) => e.dataset.veld)), ['fotoZk', 'fotoEtiket']);
    assert.strictEqual(await page.evaluate(() => location.hash), hash);
    // annuleren laat alles zoals het was
    await page.click('#foto-zk');
    await page.waitForSelector('#camera-knip:not([disabled])');
    await page.click('#camera-annuleer');
    await page.waitForSelector('#camera', { state: 'detached' });
    assert.strictEqual(await page.getAttribute('section[data-veld="fotoZk"]', 'data-foto'), 'nee');
    await neemFoto(page, 'zk');
    await neemFoto(page, 'etiket');
    // herladen (zoals wanneer Android het tabblad uit het geheugen gooit): de foto's zijn er nog
    await page.reload();
    await page.waitForSelector('section[data-veld="fotoZk"][data-foto="ja"] img.foto-klein');
    await page.waitForSelector('section[data-veld="fotoEtiket"][data-foto="ja"] img.foto-klein');
    const eersteFoto = await page.evaluate(async () => new Promise((res) => { const r = indexedDB.open('qc-rondgang'); r.onsuccess = () => { const q = r.result.transaction('fotos').objectStore('fotos').getAll(); q.onsuccess = () => res(q.result.map((f) => ({ soort: f.soort, type: f.blob.type, kb: Math.round(f.blob.size / 1024), status: f.status }))); }; }));
    assert.strictEqual(eersteFoto.length, 2);
    assert.ok(eersteFoto.every((f) => f.type === 'image/jpeg' && f.status === 'klaar' && f.kb >= 1), JSON.stringify(eersteFoto));
    // opnieuw nemen vervangt de foto, er blijven er twee
    await neemFoto(page, 'zk');
    assert.strictEqual(await page.evaluate(async () => new Promise((res) => { const r = indexedDB.open('qc-rondgang'); r.onsuccess = () => { const q = r.result.transaction('fotos').objectStore('fotos').count(); q.onsuccess = () => res(q.result); }; })), 2);
    await verder(page);
    await page.waitForSelector('#open-beneden');
    await wachtOpTekst(page, /^1 controle en 2 foto's wachten · geen verbinding$/);
    assert.strictEqual(acties('foto'), 0);
    // de verbinding valt weg net na het uploaden van de eerste foto: geen dubbel bestand
    srv.staat.verliesActie = 'foto';
    srv.staat.verlies = 1;
    await ctx.setOffline(false);
    await allesVerzonden(page, 30000);
    const bestanden = srv.staat.script.drive.alleBestanden();
    assert.strictEqual(bestanden.length, 2, JSON.stringify(bestanden.map((b) => b.naam)));
    assert.ok(bestanden.every((b) => /^\d{4}-\d{2}-\d{2}_L8_260102_(ZK|etiket)_[0-9a-f]{8}\.jpg$/.test(b.naam) && b.bytes > 1000), JSON.stringify(bestanden));
    assert.strictEqual(acties('foto'), 3, 'twee foto\'s, één herhaling');
    assert.deepStrictEqual([w(5, 'AK'), w(5, 'AL')], ['Foto ZK', 'Foto etiket']);
    const links = ['AK', 'AL'].map((l) => srv.staat.fx.tab.cel(5, letterNaarKolom(l)).link);
    assert.deepStrictEqual(links.slice().sort(), bestanden.map((b) => b.url).sort());
    await page.click('#open-beneden');
    await page.waitForSelector('section[data-veld="fotoZk"] img.foto-klein');
    assert.match(await page.textContent('section[data-veld="fotoZk"]'), /verzonden/);
    await page.goto(srv.appUrl + '#/einde');
    await page.waitForSelector('#eind[data-groen="true"]');
  });

  await scenario('de foto gaat pas weg nadat de controle in de sheet staat; is de rij daarna uit de sheet verdwenen, dan zegt de app waarom de foto wacht', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    srv.staat.weiger = ['controle'];
    await begin(page, '260103', 'beneden');
    await vulBeneden(page);
    await wachtOpTekst(page, /^1 controle en 1 foto wachten · Fout: Tijdelijk geweigerd/);
    await page.click('#nu-sync');
    await tot(() => acties('controle') >= 2, 'tweede poging voor de controle');
    await page.waitForTimeout(500);
    assert.strictEqual(acties('foto'), 0, 'geen upload zolang de rij niet bestaat');
    assert.strictEqual(w(5, 'I'), '');
    srv.staat.weiger = ['foto'];
    await page.click('#nu-sync');
    await wachtOpTekst(page, /^1 foto wacht · Fout: Tijdelijk geweigerd/);
    assert.deepStrictEqual([w(5, 'I'), w(5, 'AK')], [260103, 'volgt']);
    // iemand wist het app-ID in de sheet: het script vindt de rij niet meer
    const appIdCel = srv.staat.fx.tab.cel(5, letterNaarKolom('AY'));
    const appId = appIdCel.v;
    appIdCel.v = '';
    srv.staat.weiger = [];
    for (let i = 1; i <= 5; i++) {
      await page.click('#nu-sync');
      await tot(() => acties('foto') >= i + 1, `poging ${i} met "later"`);
      await page.waitForFunction(() => !document.querySelector('#nu-sync') || !document.querySelector('#nu-sync').disabled);
    }
    await wachtOpTekst(page, /^1 foto wacht · Fout: De rij van de controle staat niet in de sheet/);
    assert.strictEqual(srv.staat.script.drive.alleBestanden().length, 0);
    // het app-ID staat er weer: de foto volgt
    appIdCel.v = appId;
    await page.click('#nu-sync');
    await allesVerzonden(page, 30000);
    assert.deepStrictEqual([w(5, 'AK'), w(5, 'AL')], ['Foto ZK', '']);
    assert.strictEqual(srv.staat.script.drive.alleBestanden().length, 1);
  });

  await scenario('foto via "Camera-app of bestand": verkleind tot 1600 punten en bewaard als JPEG; een tik toont ze groot', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await begin(page, '260104', 'beneden');
    // een groot beeld (3000 × 2000), zoals de camera-app het geeft
    const groot = await page.evaluate(async () => {
      const doek = document.createElement('canvas'); doek.width = 3000; doek.height = 2000;
      const t = doek.getContext('2d'); t.fillStyle = '#246'; t.fillRect(0, 0, 3000, 2000); t.fillStyle = '#fc0'; t.fillRect(200, 200, 900, 500);
      const blob = await new Promise((res) => doek.toBlob(res, 'image/png'));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    await page.click('#foto-zk');
    await page.waitForSelector('#camera-knip:not([disabled])');
    const [kiezer] = await Promise.all([page.waitForEvent('filechooser'), page.click('#camera-bestand-knop')]);
    assert.strictEqual(await page.isDisabled('#camera-knip'), true, 'de camera in de pagina is losgelaten');
    await kiezer.setFiles({ name: 'IMG_0001.png', mimeType: 'image/png', buffer: Buffer.from(groot) });
    await page.waitForSelector('#camera', { state: 'detached' });
    await page.waitForSelector('section[data-veld="fotoZk"][data-foto="ja"] img.foto-klein');
    const foto = await opslag(page, async (db, vraag) => {
      const f = (await vraag(db.transaction('fotos').objectStore('fotos').getAll()))[0];
      const beeld = await createImageBitmap(f.blob);
      return { type: f.blob.type, breedte: beeld.width, hoogte: beeld.height, lijn: f.lijn };
    });
    assert.deepStrictEqual(foto, { type: 'image/jpeg', breedte: 1600, hoogte: 1067, lijn: 'L7' });
    await page.click('section[data-veld="fotoZk"] img.foto-klein');
    await page.waitForSelector('#foto-groot img');
    await page.click('#foto-groot');
    await page.waitForSelector('#foto-groot', { state: 'detached' });
  });

  await scenario('lijn: voorgevuld uit de productielijst, te wijzigen door de controleur; de keuze blijft na herladen en verversen en komt in kolom B', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    const fB = (r) => srv.staat.fx.tab.cel(r, 2).f;
    const LIJNEN = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10', 'MUL', 'STICKS', 'GELPACK 1', 'GELPACK 2', 'VOLPAK'];
    await begin(page, '260102', 'boven');
    assert.strictEqual(await page.inputValue('#lijn'), 'L8', 'de lijn van de productielijst staat er al');
    assert.deepStrictEqual(await page.$$eval('#lijn option', (os) => os.map((o) => o.textContent)), LIJNEN);
    await page.selectOption('#lijn', 'GELPACK 1');
    await page.waitForFunction(() => /planning: L8/.test(document.querySelector('.lijn-keuze').textContent));
    await page.reload();
    await page.waitForSelector('#lijn');
    assert.strictEqual(await page.inputValue('#lijn'), 'GELPACK 1');
    await page.click('#ververs');
    await page.waitForFunction(() => /Gegevens ververst/.test((document.querySelector('#melding') || {}).textContent || ''));
    assert.strictEqual(await page.inputValue('#lijn'), 'GELPACK 1', 'verversen zet de gekozen lijn niet terug');
    await vulBoven(page);
    await allesVerzonden(page);
    assert.deepStrictEqual([w(5, 'I'), w(5, 'B'), fB(5)], [260102, 'GELPACK 1', '']);
    assert.match(await page.textContent('#kop-controle'), /GELPACK 1 · 260102/);
    // bij Beneden blijkt het toch een andere lijn: dezelfde rij krijgt de nieuwe waarde
    await page.click('#open-beneden');
    await page.waitForSelector('#lijn');
    assert.strictEqual(await page.inputValue('#lijn'), 'GELPACK 1');
    await page.selectOption('#lijn', 'L9');
    await page.waitForFunction(() => /planning: L8/.test(document.querySelector('.lijn-keuze').textContent) && document.querySelector('#lijn').value === 'L9');
    await vulBeneden(page);
    await allesVerzonden(page, 30000);
    assert.deepStrictEqual([w(5, 'B'), w(5, 'Q'), w(6, 'I')], ['L9', 'AB', '']);
    assert.match(srv.staat.script.drive.alleBestanden()[0].naam, /_L9_260102_ZK_/);
    // een controle waar niets aan de lijn gewijzigd is: de lijn van de planning komt als waarde in B
    await begin(page, '260104', 'boven');
    assert.strictEqual(await page.inputValue('#lijn'), 'L7');
    await vulBoven(page);
    await allesVerzonden(page);
    assert.deepStrictEqual([w(6, 'I'), w(6, 'B'), fB(6)], [260104, 'L7', '']);
    // een pallet heeft geen lijn: niets voorgevuld, niet verplicht, de formule van de sheet blijft
    await begin(page, '50001', 'boven', { tab: 'pallet' });
    assert.strictEqual(await page.inputValue('#lijn'), '');
    assert.strictEqual(await page.$eval('#lijn', (e) => e.selectedOptions[0].textContent), 'Kies…');
    await vulBoven(page);
    await allesVerzonden(page);
    assert.deepStrictEqual([w(7, 'I'), fB(7)], [50001, '=FORMULE_B(I7)']);
  });

  await scenario('operatoren: drie aanduiden waarvan één buiten de lijst; eerste kolom = eerste naam, tweede kolom = de rest met een komma; de eigen naam staat er de volgende keer bij', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await begin(page, '260102', 'beneden');
    await vulBenedenPunten(page);
    assert.strictEqual(await operatorenTekst(page), 'AB');
    // AB eraf, dan CD, een getypte naam (met een komma, die wordt een spatie) en EF
    await page.click('#operatoren-kies');
    await page.click('#operatoren-lijst button[data-naam="AB"]');
    await page.waitForSelector('#operatoren-lijst button[data-naam="AB"]:not(.gekozen)');
    await page.click('#operatoren-klaar');
    await page.waitForSelector('#operatoren-kiezer', { state: 'detached' });
    await page.waitForSelector('#operatoren-tekst', { state: 'detached' }); // niemand gekozen = punt weer open
    await page.click('#verder');
    await page.waitForSelector('.punt.open[data-veld="operatoren"]');
    await kiesOperatoren(page, ['CD'], ['Jansen, Piet']);
    await kiesOperatoren(page, ['EF']);
    assert.strictEqual(await operatorenTekst(page), 'CD, Jansen Piet, EF');
    await page.reload(); // elke tik was al bewaard
    await page.waitForSelector('#operatoren-tekst');
    assert.strictEqual(await operatorenTekst(page), 'CD, Jansen Piet, EF');
    await verder(page);
    await allesVerzonden(page, 30000);
    assert.deepStrictEqual([w(5, 'Q'), w(5, 'R')], ['CD', 'Jansen Piet, EF']);
    assert.strictEqual(srv.staat.fx.tab.cel(6, letterNaarKolom('R')).dv.getAllowInvalid(), false, 'de keuzelijst van de volgende rij is nog streng');
    // samenvatting toont de namen
    await page.click('#open-beneden');
    assert.match(await page.textContent('tr[data-veld="operatoren"]'), /CD, Jansen Piet, EF/);
    // volgende controle: de eigen naam staat als knop bij de lijst van de sheet
    await begin(page, '260103', 'beneden');
    await page.click('#operatoren-kies');
    await page.waitForSelector('#operatoren-kiezer');
    assert.deepStrictEqual(await page.$$eval('#operatoren-lijst button', (bs) => bs.map((b) => b.dataset.naam)), [...OPERATOREN, 'Jansen Piet']);
    assert.strictEqual(await bestaat(page, '#operatoren-lijst .gekozen'), false);
    // een naam die al in de lijst staat, wordt niet dubbel toegevoegd
    await page.fill('#operator-nieuw', 'ab');
    await page.click('#operatoren-klaar'); // wat nog in het veld staat, telt mee
    await page.waitForSelector('#operatoren-kiezer', { state: 'detached' });
    assert.strictEqual(await operatorenTekst(page), 'AB');
  });

  await scenario('controle die met de vorige versie begonnen is (twee aparte operatoren): de antwoorden blijven en gaan juist naar de sheet', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await begin(page, '260102', 'beneden');
    await vulBenedenPunten(page);
    // de opslag terugzetten naar de vorm van versie 1.1: operator1 en operator2
    await opslag(page, async (db, vraag) => {
      const os = db.transaction('controles', 'readwrite').objectStore('controles');
      const c = (await vraag(os.getAll()))[0];
      delete c.delen.beneden.antwoorden.operatoren;
      c.delen.beneden.antwoorden.operator1 = 'GH';
      c.delen.beneden.antwoorden.operator2 = 'IJ';
      await vraag(os.put(c));
    });
    await page.reload();
    await page.waitForSelector('#operatoren-tekst');
    assert.strictEqual(await operatorenTekst(page), 'GH, IJ');
    await verder(page);
    await allesVerzonden(page, 30000);
    assert.deepStrictEqual([w(5, 'Q'), w(5, 'R')], ['GH', 'IJ']);
  });

  await scenario('foto opmerking: niet verplicht, komt in een eigen kolom, wissen maakt de cel leeg; een opnieuw genomen foto stuurt de oude naar de prullenbak', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    const bestanden = () => srv.staat.script.drive.alleBestanden();
    await begin(page, '260102', 'beneden');
    await vulBenedenPunten(page);
    await neemFoto(page, 'opmerking');
    await verder(page);
    await page.waitForSelector('#open-beneden');
    await allesVerzonden(page, 30000);
    assert.deepStrictEqual([w(5, 'AK'), w(5, 'AL'), w(5, 'BI')], ['Foto ZK', '', 'Foto opmerking']);
    assert.deepStrictEqual(bestanden().map((b) => [/_(ZK|opmerking)_/.exec(b.naam)[1], b.prullenbak]).sort(), [['ZK', false], ['opmerking', false]]);
    // corrigeren: foto ZK opnieuw nemen en de foto bij de opmerking wissen
    await page.click('#open-beneden');
    await page.click('#corrigeren');
    await page.waitForSelector('#verder');
    await neemFoto(page, 'zk');
    await page.click('#foto-opmerking-wis');
    await page.waitForSelector('section[data-veld="fotoOpmerking"][data-foto="nee"]');
    await verder(page);
    await tot(() => bestanden().length === 3, 'de nieuwe foto ZK is bewaard');
    await allesVerzonden(page, 30000);
    assert.deepStrictEqual([w(5, 'AK'), w(5, 'BI')], ['Foto ZK', '']);
    const zk = bestanden().filter((b) => /_ZK_/.test(b.naam));
    assert.deepStrictEqual(zk.map((b) => b.prullenbak).sort(), [false, true], 'de oude foto ZK staat in de prullenbak');
    assert.strictEqual(srv.staat.fx.tab.cel(5, letterNaarKolom('AK')).link, zk.find((b) => !b.prullenbak).url, 'de cel wijst naar de nieuwe');
    assert.strictEqual(bestanden().find((b) => /_opmerking_/.test(b.naam)).prullenbak, true);
    await page.goto(srv.appUrl + '#/einde');
    await page.waitForSelector('#eind[data-groen="true"]');
  });

  await scenario('controle verwijderen neemt de foto\'s mee', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await ctx.setOffline(true);
    await begin(page, '260104', 'beneden');
    await vulBeneden(page, { etiket: 'foto' });
    await wachtOpTekst(page, /^1 controle en 2 foto's wachten/);
    await page.click('#verwijder');
    await page.click('#verwijder-ja');
    await page.waitForSelector('#nieuwe-controle');
    await allesVerzonden(page);
    const telling = await page.evaluate(async () => new Promise((res) => { const r = indexedDB.open('qc-rondgang'); r.onsuccess = () => { const tx = r.result.transaction(['fotos', 'wachtrij']); const a = tx.objectStore('fotos').count(); const b = tx.objectStore('wachtrij').count(); tx.oncomplete = () => res([a.result, b.result]); }; }));
    assert.deepStrictEqual(telling, [0, 0]);
    await ctx.setOffline(false);
    await page.waitForTimeout(600);
    assert.strictEqual(acties('controle') + acties('foto'), 0);
  });

  await scenario('werkmaterialen boven: elk punt OK of een opmerking, offline afsluiten, juiste rij in de sheet, corrigeren', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    const ww = (r, c) => srv.staat.fx.werk.waarde(r, c);
    assert.match(await page.textContent('#tegel-werk'), /nog niet gedaan/);
    await ctx.setOffline(true);
    await page.click('#tegel-werk');
    await page.waitForSelector('#verder');
    assert.strictEqual(await bestaat(page, '.gekozen'), false, 'niets vooraf ingevuld');
    // open punten worden geweigerd
    await page.click('#verder');
    await page.waitForSelector('#open-melding');
    assert.strictEqual(await page.$$eval('.punt.open', (e) => e.length), 3);
    let gezien = await vulDagScherm(page);
    assert.deepStrictEqual(gezien, ['Trechter 1 - Vierkant', 'Trechter 2 - Zwaar', 'Trechter 3 - Klein']);
    await verder(page);
    gezien = await vulDagScherm(page, { 'Werk- & poetsmateriaal L5': '' });
    assert.deepStrictEqual(gezien, ['Inspectie afvulbuizen', 'Werk- & poetsmateriaal L4', 'Werk- & poetsmateriaal L5']);
    // "Opmerking" zonder tekst is nog open
    await page.click('#verder');
    await page.waitForSelector('.punt.open[data-punt="Werk- & poetsmateriaal L5"]');
    await page.fill('section[data-punt="Werk- & poetsmateriaal L5"] textarea', 'halve maan sleutel weg');
    await verder(page);
    await page.reload(); // alles was al bewaard
    await page.waitForSelector('#verder');
    await vulDagScherm(page, { 'Mottenval L4': '6 motten' });
    await verder(page);
    await page.waitForSelector('#tegel-werk[data-status="klaar"]');
    await wachtOpTekst(page, /^1 dagcontrole wacht · geen verbinding$/);
    assert.strictEqual(ww(10, 2), '');
    await ctx.setOffline(false);
    await allesVerzonden(page);
    await page.waitForSelector('#tegel-werk[data-status="verzonden"]');
    assert.deepStrictEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((c) => ww(10, c)), ['OK', 'OK', 'OK', 'OK', 'OK', 'halve maan sleutel weg', 'OK', 'OK', '6 motten', 'Ja']);
    assert.strictEqual(ww(9, 2), '');
    assert.strictEqual(ww(11, 2), '');
    // corrigeren: zelfde rij
    await page.click('#tegel-werk');
    await page.click('#corrigeren');
    await page.waitForSelector('#verder');
    await verder(page);
    await page.click('section[data-punt="Werk- & poetsmateriaal L5"] button[data-waarde="ok"]');
    await page.waitForSelector('section[data-punt="Werk- & poetsmateriaal L5"] button[data-waarde="ok"].gekozen');
    await verder(page); await verder(page);
    await tot(() => acties('dagcontrole') === 2, 'de correctie is verzonden');
    await allesVerzonden(page);
    assert.strictEqual(ww(10, 7), 'OK');
    assert.strictEqual(ww(10, 10), '6 motten');
    assert.strictEqual(acties('dagcontrole'), 2);
  });

  await scenario('magazijn en bufferzone: metingen, OK of NOK met opmerking, eerste vrije rij, opnieuw verzenden geeft geen dubbel', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    const mw = (r, l) => srv.staat.fx.mag.waarde(r, letterNaarKolom(l));
    await page.click('#tegel-magazijn');
    await page.waitForSelector('#verder');
    assert.deepStrictEqual(await page.$$eval('section[data-meting] h3', (els) => els.map((e) => e.textContent)), ['Temperatuur magazijn (in C°)', 'Temperatuur Koelkast eetzaal', 'Luchtvochtigheid magazijn (in %)20,7']);
    await page.click('#verder');
    await page.waitForSelector('#open-melding');
    assert.strictEqual(await page.$$eval('.punt.open', (e) => e.length), 3);
    await page.fill('[data-invoer="meting-0"]', '21,5');
    await page.fill('[data-invoer="meting-1"]', '3');
    await page.fill('[data-invoer="meting-2"]', 'warm');
    await page.click('#verder');
    await page.waitForFunction(() => document.querySelectorAll('.punt.open').length === 1); // opnieuw getekend: alleen de foute meting is nog open
    await page.waitForSelector('.punt.open[data-meting="Luchtvochtigheid magazijn (in %)20,7"]');
    await page.fill('[data-invoer="meting-2"]', '48');
    await verder(page);
    const koppen = await vulDagScherm(page, { [MAGAZIJN_PUNTEN[1].kop]: 'heftruck lekt olie' });
    assert.deepStrictEqual(koppen, MAGAZIJN_PUNTEN.filter((p) => p.actief).map((p) => p.kop), 'het punt zonder selectievakjes wordt niet gevraagd');
    srv.staat.verliesActie = 'dagcontrole';
    srv.staat.verlies = 1;
    await verder(page);
    await page.waitForSelector('#tegel-magazijn[data-status="klaar"]');
    await allesVerzonden(page, 20000);
    assert.strictEqual(acties('dagcontrole'), 2);
    assert.deepStrictEqual([mw(6, 'B'), mw(6, 'C'), mw(6, 'D')], [21.5, 3, 48]);
    assert.deepStrictEqual([mw(6, 'E'), mw(6, 'F'), mw(6, 'G')], [true, false, 'NVT']);
    assert.deepStrictEqual([mw(6, 'H'), mw(6, 'I'), mw(6, 'J')], [false, true, 'heftruck lekt olie']);
    assert.strictEqual(mw(7, 'B'), '', 'geen tweede rij');
    assert.strictEqual(mw(5, 'J'), 'heftruck vuil');
    await page.goto(srv.appUrl + '#/einde');
    await page.waitForSelector('#eind[data-groen="true"]');
    assert.match(await page.textContent('#dag-niet-gedaan'), /Werkmaterialen boven/);
  });

  await scenario('dagcontrole van een eerdere dag: blijft bij haar dag, staat op het startscherm, afsluiten schrijft de rij van die dag, of verwijderen', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    const ww = (r, c) => srv.staat.fx.werk.waarde(r, c);
    const gisteren = iso(dag(-1));
    const eergisteren = iso(dag(-2));
    await page.click('#tegel-werk');
    await page.waitForSelector('#verder');
    await vulDagScherm(page);
    // de tablet blijft liggen tot de volgende dag: de begonnen controle is die van gisteren
    await opslag(page, async (db, vraag, d) => {
      const os = db.transaction('dagcontroles', 'readwrite').objectStore('dagcontroles');
      const alle = await vraag(os.getAll());
      const dc = alle[0];
      await vraag(os.delete(dc.id));
      await vraag(os.put({ ...dc, id: 'werk:' + d.gisteren, datum: d.gisteren }));
      await vraag(os.put({ ...dc, id: 'magazijn:' + d.eergisteren, soort: 'magazijn', datum: d.eergisteren, antwoorden: {}, metingen: { x: '1' } }));
    }, { gisteren, eergisteren });
    await page.goto(srv.appUrl);
    await page.reload();
    await page.waitForSelector(`.rij[data-dag="werk:${gisteren}"]`);
    assert.match(await page.textContent('#tegel-werk'), /nog niet gedaan/, 'de controle van vandaag is nog niet begonnen');
    await page.goto(srv.appUrl + '#/einde');
    await page.waitForSelector('#dag-eerder-open');
    assert.match(await page.textContent('#dag-eerder-open'), /Magazijn en bufferzone.*Werkmaterialen boven/, 'oudste eerst');
    await page.goto(srv.appUrl);
    await page.click(`.rij[data-dag="werk:${gisteren}"]`);
    await page.waitForSelector('#dag-eerder');
    assert.strictEqual(await page.$$eval('button[data-waarde="ok"].gekozen', (e) => e.length), 3, 'de antwoorden van gisteren staan er nog');
    await verder(page);
    await vulDagScherm(page, { 'Inspectie afvulbuizen': 'buis 3 gebarsten' });
    // elk antwoord gaat naar de controle van gisteren; er ontstaat geen controle voor vandaag
    assert.deepStrictEqual(await opslag(page, (db, vraag) => vraag(db.transaction('dagcontroles').objectStore('dagcontroles').getAllKeys())), [`magazijn:${eergisteren}`, `werk:${gisteren}`]);
    await verder(page);
    await vulDagScherm(page);
    await verder(page);
    await page.waitForSelector('#tegel-werk');
    await tot(() => ww(9, 11) === 'Ja', 'de rij van gisteren is geschreven');
    await allesVerzonden(page);
    assert.deepStrictEqual([ww(9, 2), ww(9, 5), ww(9, 11)], ['OK', 'buis 3 gebarsten', 'Ja'], 'de rij van gisteren');
    assert.deepStrictEqual([ww(10, 2), ww(10, 11)], ['', ''], 'de rij van vandaag blijft leeg');
    assert.strictEqual(await bestaat(page, `.rij[data-dag="werk:${gisteren}"]`), false);
    assert.match(await page.textContent('#tegel-werk'), /nog niet gedaan/);
    // de andere niet meer afwerken: verwijderen vraagt een tweede tik
    await page.click(`.rij[data-dag="magazijn:${eergisteren}"]`);
    await page.waitForSelector('#dag-weg');
    await page.click('#dag-weg');
    await page.click('#dag-weg-nee'); // toch niet
    await page.waitForSelector('#dag-weg-nee', { state: 'detached' });
    await page.click('#dag-weg');
    await page.waitForSelector('#dag-weg-nee');
    await page.click('#dag-weg');
    await page.waitForSelector('#tegel-werk');
    assert.strictEqual(await bestaat(page, '.rij[data-dag]'), false);
    assert.deepStrictEqual(await opslag(page, (db, vraag) => vraag(db.transaction('dagcontroles').objectStore('dagcontroles').getAllKeys())), [`werk:${gisteren}`]);
    assert.strictEqual(acties('dagcontrole'), 1);
  });

  await scenario('dagcontrole van gisteren wacht nog en een kolom is intussen hernoemd: zichtbare fout, corrigeren kan nog, daarna in de rij van gisteren', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    const ww = (r, c) => srv.staat.fx.werk.waarde(r, c);
    const gisteren = iso(dag(-1));
    await ctx.setOffline(true);
    await page.click('#tegel-werk');
    await page.waitForSelector('#verder');
    await vulDagScherm(page); await verder(page);
    await vulDagScherm(page); await verder(page);
    await vulDagScherm(page); await verder(page);
    await wachtOpTekst(page, /^1 dagcontrole wacht/);
    await opslag(page, async (db, vraag, g) => {
      const tx = db.transaction(['dagcontroles', 'wachtrij'], 'readwrite');
      const dc = (await vraag(tx.objectStore('dagcontroles').getAll()))[0];
      const item = (await vraag(tx.objectStore('wachtrij').getAll()))[0];
      await vraag(tx.objectStore('dagcontroles').delete(dc.id));
      await vraag(tx.objectStore('wachtrij').delete(item.id));
      await vraag(tx.objectStore('dagcontroles').put({ ...dc, id: 'werk:' + g, datum: g }));
      await vraag(tx.objectStore('wachtrij').put({ ...item, id: 'dag:werk:' + g, dagId: 'werk:' + g }));
    }, gisteren);
    srv.staat.fx.werk.cel(2, 10).v = 'Mottenval L4 en L5'; // kop hernoemd in de sheet
    await ctx.setOffline(false);
    await page.goto(srv.appUrl);
    await page.reload();
    await wachtOpTekst(page, /Fout: Niet gevonden in "Rondgang Werkmaterialen Boven": Mottenval L4\. Ververs/);
    assert.strictEqual(ww(9, 2), '', 'niets half geschreven');
    await page.click('#ververs');
    await page.waitForFunction(() => /Gegevens ververst/.test((document.querySelector('#melding') || {}).textContent || ''));
    await page.click(`.rij[data-dag="werk:${gisteren}"][data-status="klaar"]`);
    await page.click('#corrigeren');
    await page.waitForSelector('#verder');
    await verder(page); await verder(page);
    assert.deepStrictEqual(await page.$$eval('section[data-punt]', (els) => els.map((e) => [e.dataset.punt, !!e.querySelector('.gekozen')])).then((x) => x[x.length - 1]), ['Mottenval L4 en L5', false], 'het hernoemde punt is opnieuw te beantwoorden');
    await vulDagScherm(page);
    await verder(page);
    await tot(() => ww(9, 11) === 'Ja', 'de rij van gisteren is geschreven');
    await allesVerzonden(page);
    assert.deepStrictEqual([ww(9, 2), ww(9, 10), ww(9, 11)], ['OK', 'OK', 'Ja']);
    assert.strictEqual(ww(10, 2), '');
  });

  await scenario('opruimen na 14 dagen: een controle met een foto die nog niet verzonden is, blijft staan tot de foto weg is', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    srv.staat.weiger = ['foto'];
    await begin(page, '260102', 'beneden');
    await vulBeneden(page);
    await wachtOpTekst(page, /^1 foto wacht · Fout: Tijdelijk geweigerd/);
    assert.strictEqual(w(5, 'AK'), 'volgt');
    const tel = () => opslag(page, async (db, vraag) => {
      const tx = db.transaction(['controles', 'fotos', 'wachtrij']);
      return [await vraag(tx.objectStore('controles').count()), await vraag(tx.objectStore('fotos').count()), await vraag(tx.objectStore('wachtrij').count())];
    });
    // drie weken later staat de foto er nog altijd
    await opslag(page, async (db, vraag) => {
      const os = db.transaction('controles', 'readwrite').objectStore('controles');
      const c = (await vraag(os.getAll()))[0];
      c.aangemaaktOm -= 21 * 24 * 60 * 60 * 1000;
      await vraag(os.put(c));
    });
    await page.goto(srv.appUrl);
    await page.reload();
    await page.waitForSelector('#tegel-controles');
    assert.deepStrictEqual(await tel(), [1, 1, 1], 'controle, foto en wachtrij zijn er nog');
    srv.staat.weiger = [];
    await page.click('#nu-sync');
    await allesVerzonden(page, 30000);
    assert.strictEqual(w(5, 'AK'), 'Foto ZK');
    assert.strictEqual(srv.staat.script.drive.alleBestanden().length, 1);
    // nu alles verzonden is, mag de oude controle weg
    await page.reload();
    await page.waitForSelector('#tegel-controles');
    assert.deepStrictEqual(await tel(), [0, 0, 0]);
  });

  await scenario('opslag van de vorige versie staat nog open in een ander tabblad: de app wacht met een melding en gaat daarna vanzelf verder', async (ctx) => {
    // Een tabblad met de opslag van fase 1 (versie 1), zonder de nieuwe code.
    const oud = await ctx.newPage();
    await oud.goto(srv.appUrl + 'css/app.css');
    await oud.evaluate(() => new Promise((res, rej) => {
      const r = indexedDB.open('qc-rondgang', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('instellingen'); db.createObjectStore('referentie');
        db.createObjectStore('controles', { keyPath: 'appId' }); db.createObjectStore('wachtrij', { keyPath: 'id' });
      };
      r.onsuccess = () => { window.verbinding = r.result; const tx = r.result.transaction('instellingen', 'readwrite'); tx.objectStore('instellingen').put('bewaard', 'proef'); tx.oncomplete = () => res(true); };
      r.onerror = () => rej(r.error);
    }));
    const page = await pagina(ctx, { wachtOpSw: false });
    await page.waitForSelector('#opslag-wacht');
    assert.match(await page.textContent('#opslag-wacht'), /ander tabblad of venster/);
    await oud.evaluate(() => window.verbinding.close());
    await page.waitForSelector('#inst-url');
    const winkels = await opslag(page, async (db, vraag) => [[...db.objectStoreNames].sort(), db.version, await vraag(db.transaction('instellingen').objectStore('instellingen').get('proef'))]);
    assert.deepStrictEqual(winkels, [['controles', 'dagcontroles', 'fotos', 'instellingen', 'referentie', 'wachtrij'], 2, 'bewaard'], 'bijgewerkt zonder iets te verliezen');
    await stelIn(page);
  });

  await scenario('app gesloten: Background Sync verzendt de wachtrij vanuit de service worker', async (ctx) => {
    await ctx.grantPermissions(['background-sync', 'camera'], { origin: new URL(srv.appUrl).origin });
    const page = await pagina(ctx);
    await stelIn(page);
    await ctx.setOffline(true);
    await begin(page, '260103', 'boven');
    await vulBoven(page);
    await wachtOpTekst(page, /^1 controle wacht/);
    const tags = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).sync.getTags()));
    assert.deepStrictEqual(tags, ['qc-wachtrij'], 'Background Sync is aangevraagd');
    await page.goto('about:blank'); // de app staat niet meer open
    const cdp = await ctx.newCDPSession(page);
    const registraties = [];
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => registraties.push(...e.registrations));
    await cdp.send('ServiceWorker.enable');
    await new Promise((r) => setTimeout(r, 500));
    const reg = registraties.find((r) => r.scopeURL === srv.appUrl);
    assert.ok(reg, 'registratie van de service worker gevonden');
    await ctx.setOffline(false);
    await cdp.send('ServiceWorker.dispatchSyncEvent', { origin: new URL(srv.appUrl).origin, registrationId: reg.registrationId, tag: 'qc-wachtrij', lastChance: false });
    for (let i = 0; i < 50 && w(5, 'I') === ''; i++) await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(w(5, 'I'), 260103);
    await page.goto(srv.appUrl);
    await page.waitForSelector('#tegel-controles');
    await allesVerzonden(page);
    await page.goto(srv.appUrl + '#/controles');
    await page.waitForSelector('.rij[data-code="260103"]');
    assert.strictEqual(await chip(page, '260103', 'boven'), 'verzonden');
    assert.strictEqual(acties('controle'), 1);
  });

  await browser.close();
  await srv.stop();
  const mis = uitslag.filter((u) => !u.ok);
  console.log(`\n${uitslag.length - mis.length} geslaagd, ${mis.length} mislukt`);
  if (mis.length) { console.log('Mislukt: ' + mis.map((m) => m.naam).join('; ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
