// Test van de app in een echte browser (Chromium) tegen het echte Code.gs op een
// nagebootste sheet. Volgt hoofdstuk 11 van het bouwplan, voor zover het over
// fase 1 gaat. Uitvoeren: node test/app.test.cjs
const assert = require('assert');
// Eenmalig: npm install playwright && npx playwright install chromium
const { chromium } = require(process.env.PLAYWRIGHT_PAD || 'playwright');
const { start } = require('./server.cjs');
const { letterNaarKolom } = require('./nep-apps-script.cjs');
const { OPERATOREN, OK3, OK4, JA_NEE, TRECHTERS } = require('./fixture.cjs');

let srv;
let browser;
const uitslag = [];

const w = (r, l) => srv.staat.fx.tab.waarde(r, letterNaarKolom(l));
const formule = (r, l) => (srv.staat.fx.tab.cel(r, letterNaarKolom(l)) || {}).f || '';
const acties = (naam) => srv.staat.verzoeken.filter((v) => v.actie === naam).length;

async function context() {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 1180 }, hasTouch: true, locale: 'nl-BE', timezoneId: 'Europe/Brussels' });
  // Op een tablet met de geïnstalleerde app staat Background Sync standaard aan.
  await ctx.grantPermissions(['background-sync'], { origin: new URL(srv.appUrl).origin });
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
async function kies(page, veld, waarde) {
  const sel = `section[data-veld="${veld}"] button[data-waarde="${waarde}"]`;
  await page.click(sel);
  await page.waitForSelector(sel + '.gekozen');
}
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
async function vulBeneden(page, { checkweger = 'NEE', md = 'NEE', snelheid = '52', operator = 'AB' } = {}) {
  await kies(page, 'lotZkCorrect', 'true');
  await kies(page, 'allergenenCorrect', 'true');
  await kies(page, 'operator1', operator);
  await kies(page, 'operator2', '');
  await verder(page);
  await kies(page, 'checkweger', checkweger);
  if (checkweger === 'JA') for (const v of ['cwGewicht', 'cwPlus', 'cwMin']) await kies(page, v, 'OK');
  await verder(page);
  await kies(page, 'metaaldetector', md);
  if (md === 'JA') await kies(page, 'mdUitworp', 'OK');
  await kies(page, 'monoDuo', '2');
  await page.fill('[data-invoer="snelheid"]', snelheid);
  await verder(page);
  for (const v of ['cProduct', 'cHoudbaarheid', 'cGewicht', 'cZk', 'cDi']) await kies(page, v, 'OK');
  await verder(page);
  for (const v of ['cDs', 'cEtiket', 'cDocumenten', 'cAllergenen']) await kies(page, v, 'OK');
  await verder(page);
  await page.waitForSelector('#open-beneden');
}
// Nooit een ElementHandle in een assert: bij een mislukking probeert Node het hele object uit te schrijven.
const bestaat = async (page, sel) => (await page.$(sel)) !== null;
async function wachtOpTekst(page, re, timeout = 20000) {
  await page.waitForFunction((bron) => new RegExp(bron).test((document.querySelector('#wachtrij-tekst') || {}).textContent || ''), re.source, { timeout });
}
const allesVerzonden = (page, timeout) => wachtOpTekst(page, /^Alles verzonden/, timeout);
const knoppen = (page, veld) => page.$$eval(`section[data-veld="${veld}"] button.keuze`, (bs) => bs.map((b) => b.textContent));
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
  browser = await chromium.launch({ channel: 'chromium' });
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
    assert.strictEqual(await bestaat(page, '.gekozen'), false);
    assert.deepStrictEqual(await knoppen(page, 'grdCorrect'), ['Ja', 'Nee']);
    assert.deepStrictEqual(await knoppen(page, 'trechter'), [...TRECHTERS, 'Geen trechter of mes']);
    assert.deepStrictEqual(await knoppen(page, 'ordeNetheid'), OK4);
    assert.strictEqual(await page.inputValue('[data-invoer="opmBoven"]'), '');
    await page.goto(srv.appUrl + '#/controles');
    await page.click('.rij[data-code="260102"]');
    await page.click('#open-beneden');
    await page.waitForSelector('#verder');
    assert.strictEqual(await bestaat(page, '.gekozen'), false);
    assert.deepStrictEqual(await knoppen(page, 'operator1'), OPERATOREN);
    assert.deepStrictEqual(await knoppen(page, 'operator2'), [...OPERATOREN, 'Geen tweede operator']);
    await kies(page, 'lotZkCorrect', 'true'); await kies(page, 'allergenenCorrect', 'false'); await kies(page, 'operator1', 'CD'); await kies(page, 'operator2', 'Interim/Flexi');
    await verder(page);
    assert.strictEqual(await bestaat(page, '.gekozen'), false);
    assert.deepStrictEqual(await knoppen(page, 'checkweger'), JA_NEE);
    assert.deepStrictEqual(await knoppen(page, 'cwGewicht'), OK3);
    await kies(page, 'checkweger', 'JA'); for (const v of ['cwGewicht', 'cwPlus', 'cwMin']) await kies(page, v, 'OK');
    await verder(page);
    assert.deepStrictEqual(await knoppen(page, 'metaaldetector'), JA_NEE);
    assert.deepStrictEqual(await knoppen(page, 'mdUitworp'), OK3);
    assert.deepStrictEqual(await knoppen(page, 'monoDuo'), ['1', '2']);
    assert.strictEqual(await page.inputValue('[data-invoer="snelheid"]'), '');
    await kies(page, 'metaaldetector', 'JA'); await kies(page, 'mdUitworp', 'OK'); await kies(page, 'monoDuo', '1'); await page.fill('[data-invoer="snelheid"]', '40');
    await verder(page);
    for (const v of ['cProduct', 'cHoudbaarheid', 'cGewicht', 'cZk', 'cDi']) assert.deepStrictEqual(await knoppen(page, v), OK4);
    for (const v of ['cProduct', 'cHoudbaarheid', 'cGewicht', 'cZk', 'cDi']) await kies(page, v, 'OK');
    await verder(page);
    for (const v of ['cDs', 'cEtiket', 'cDocumenten', 'cAllergenen']) assert.deepStrictEqual(await knoppen(page, v), OK4);
  });

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
    await wachtOpTekst(page, /^3 controles wachten/);
    assert.strictEqual(acties('controle'), 0);
    await page.reload();
    await page.waitForSelector('#kop-controle');
    await wachtOpTekst(page, /^3 controles wachten/);

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
    await kies(page, 'lotZkCorrect', 'true'); await kies(page, 'allergenenCorrect', 'true'); await kies(page, 'operator1', 'GH'); await kies(page, 'operator2', '');
    await verder(page); await kies(page, 'checkweger', 'NEE'); await verder(page);
    await kies(page, 'metaaldetector', 'JA');
    await page.fill('[data-invoer="snelheid"]', '47');
    await page.reload();
    await page.waitForSelector('section[data-veld="metaaldetector"] button[data-waarde="JA"].gekozen');
    assert.strictEqual(await page.inputValue('[data-invoer="snelheid"]'), '47');
    assert.strictEqual(await bestaat(page, 'section[data-veld="mdUitworp"] .gekozen'), false);
    await page.click('#vorige');
    await page.waitForSelector('section[data-veld="checkweger"] button[data-waarde="NEE"].gekozen');
    await page.goto(srv.appUrl + '#/controles');
    await page.waitForSelector('.rij[data-code="260104"]');
    assert.strictEqual(await chip(page, '260104', 'beneden'), 'bezig');
  });

  await scenario('Checkweger en Metaaldetector: automatische NVT in de app en de formule in de sheet', async (ctx) => {
    const page = await pagina(ctx);
    await stelIn(page);
    await begin(page, '260102', 'beneden');
    await kies(page, 'lotZkCorrect', 'true'); await kies(page, 'allergenenCorrect', 'true'); await kies(page, 'operator1', 'AB'); await kies(page, 'operator2', '');
    await verder(page);
    // JA: de drie punten moeten beantwoord worden
    await kies(page, 'checkweger', 'JA');
    await page.click('#verder');
    await page.waitForSelector('#open-melding');
    assert.deepStrictEqual(await page.$$eval('.punt.open', (els) => els.map((e) => e.dataset.veld)), ['cwGewicht', 'cwPlus', 'cwMin']);
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
    await verder(page);
    // Metaaldetector blijft een vraag, ook los van Checkweger
    assert.strictEqual(await bestaat(page, 'section[data-veld="metaaldetector"].vervallen'), false);
    await kies(page, 'metaaldetector', 'NEE');
    assert.match(await page.textContent('section[data-veld="mdUitworp"]'), /NVT \(automatisch\)/);
    await kies(page, 'monoDuo', '1'); await page.fill('[data-invoer="snelheid"]', '38');
    await verder(page);
    for (const v of ['cProduct', 'cHoudbaarheid', 'cGewicht', 'cZk', 'cDi']) await kies(page, v, 'OK');
    await verder(page);
    for (const v of ['cDs', 'cEtiket', 'cDocumenten', 'cAllergenen']) await kies(page, v, 'OK');
    await verder(page);
    await allesVerzonden(page);
    assert.deepStrictEqual(['T', 'U', 'V'].map((l) => [w(5, l), formule(5, l)]), [['OK', ''], ['OK', ''], ['OK', '']]);
    assert.deepStrictEqual([w(5, 'X'), formule(5, 'X')], ['NVT', '=if(W5="nee";"NVT";)']);

    // Corrigeren naar NEE: de formule staat er weer
    await page.click('#open-beneden');
    await page.click('#corrigeren');
    await page.waitForSelector('#verder');
    await verder(page);
    await kies(page, 'checkweger', 'NEE');
    await verder(page); await verder(page); await verder(page); await verder(page);
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
    await page.waitForSelector('section[data-veld="trechter"] button[data-waarde="4"].gekozen');
    assert.strictEqual(await page.inputValue('[data-invoer="opmBoven"]'), 'nog bezig');
    assert.strictEqual(await page.textContent('#scherm > .kaart dd[data-opzoek="lotGrd"]'), '444999');
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

  await scenario('app gesloten: Background Sync verzendt de wachtrij vanuit de service worker', async (ctx) => {
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
