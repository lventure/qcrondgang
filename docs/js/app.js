// QC Rondgang - schermen en bediening (fase 1: productiecontroles zonder foto's).
import * as db from './db.js';
import { roep } from './api.js';
import * as sync from './sync.js';
import * as M from './model.js';
import { APP_VERSIE } from './versie.js';

const $balk = document.getElementById('balk');
const $scherm = document.getElementById('scherm');

let snapshot = null;       // laatste opgehaalde gegevens
let ingesteld = false;     // adres en sleutel ingegeven?
let melding = null;        // { soort, tekst } bovenaan het scherm
let toonOpen = false;      // open punten markeren op dit scherm
let toonOpenNa = false;    // ... na de volgende navigatie
let verversBezig = false;
let swWacht = null;        // nieuwe versie van de app staat klaar
let herlaadNaUpdate = false;
let renderTeller = 0;
let syncTimer = null;
const SNAPSHOT_WACHT_MS = 150000; // de bronsheets zijn zwaar; intussen blijft de app bruikbaar
let bevestigWeg = null;    // app-ID waarvoor "verwijderen" om bevestiging vraagt
const nieuw = { tab: 'order', lijn: '', zoek: '', gekozen: null }; // toestand van "Nieuwe controle"

/* ------------------------------------------------------------------ */
/* Hulpfuncties                                                        */
/* ------------------------------------------------------------------ */

function h(tag, attrs, ...kinderen) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kind of kinderen.flat(Infinity)) {
    if (kind == null || kind === false) continue;
    el.append(kind.nodeType ? kind : document.createTextNode(String(kind)));
  }
  return el;
}

const p2 = (n) => String(n).padStart(2, '0');
function uur(ts) {
  const d = new Date(ts);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
function dagEnUur(ts) {
  const d = new Date(ts);
  return M.vandaag(d) === M.vandaag() ? uur(ts) : `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${uur(ts)}`;
}
function datumLang(iso) {
  const [j, m, d] = iso.split('-').map(Number);
  return new Date(j, m - 1, d).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function route() {
  return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
}
function ga(hash, { markeerOpen = false } = {}) {
  toonOpenNa = markeerOpen;
  if (location.hash === hash) { toonOpen = markeerOpen; toonOpenNa = false; toon(); } else location.hash = hash;
}
/** over = aantal navigaties dat de melding nog blijft staan. */
function zetMelding(soort, tekst, over = 0) {
  melding = tekst ? { soort, tekst, over } : null;
}

const STATUSTEKST = { open: 'open', bezig: 'bezig', klaar: 'klaar, wacht op verzenden', verzonden: 'verzonden' };
const isOpenDeel = (d) => d.status === 'open' || d.status === 'bezig';

function kleurKlasse(k) {
  if (k.leeg) return 'k-leeg';
  if (k.waarde === true) return 'k-ja';
  if (k.waarde === false) return 'k-nee';
  const t = String(k.tekst).trim().toLowerCase();
  return ['ok', 'nok', 'nvt', 'stop', 'ja', 'nee'].includes(t) ? `k-${t}` : '';
}

function toonAntwoord(id, antwoorden) {
  if (M.isVervallen(id, antwoorden)) return 'NVT (automatisch)';
  const a = antwoorden[id];
  const v = M.VELDEN[id];
  if (a === undefined) return '—';
  if (v.soort === 'vakje') return a ? 'Ja' : 'Nee';
  if (a === '') return v.leegKeuze || '—';
  return String(a);
}

/* ------------------------------------------------------------------ */
/* Balk bovenaan: gegevens + wachtrij                                  */
/* ------------------------------------------------------------------ */

async function werkBalkBij() {
  const r = route();
  const thuis = r.length === 0;
  const t = await sync.toestand();
  const rijen = [];

  rijen.push(h('div', { class: 'balk-rij' },
    !thuis && ingesteld ? h('button', { class: 'balk-knop', id: 'terug', onclick: terug }, '‹ Terug') : null,
    h('h1', { class: 'balk-titel' }, 'QC Rondgang'),
    thuis && ingesteld ? h('button', { class: 'balk-knop', id: 'naar-instellingen', onclick: () => ga('#/instellingen') }, 'Instellingen') : null
  ));

  if (ingesteld) {
    let stip = 'stip';
    let tekst = 'Alles verzonden';
    if (t.aantal) {
      stip = 'stip wacht';
      const delen = [];
      if (t.controles) delen.push(`${t.controles} ${t.controles === 1 ? 'controle wacht' : 'controles wachten'}`);
      if (t.fotos) delen.push(`${t.fotos} foto's`);
      tekst = delen.join(' en ');
      if (t.fout) { stip = 'stip fout'; tekst += ` · Fout: ${t.fout}`; }
    }
    if (!navigator.onLine || (t.geenVerbinding && !t.fout)) tekst += ' · geen verbinding';
    rijen.push(h('div', { class: 'balk-rij' },
      h('div', { class: 'balk-info', id: 'gegevens' },
        h('span', {}, snapshot ? `Gegevens van ${dagEnUur(snapshot.opgehaaldOm)}` : 'Nog geen gegevens'),
        h('button', { class: 'balk-knop', id: 'ververs', disabled: verversBezig, onclick: () => ververs() }, verversBezig ? 'Bezig…' : 'Verversen')),
      h('div', { class: 'balk-info', id: 'wachtrij' },
        h('i', { class: stip }),
        h('span', { id: 'wachtrij-tekst', title: tekst }, tekst),
        t.aantal ? h('button', { class: 'balk-knop', id: 'nu-sync', disabled: sync.isBezig(), onclick: () => sync.verwerk({ handmatig: true }) }, sync.isBezig() ? 'Bezig…' : 'Nu synchroniseren') : null)
    ));
  }
  if (swWacht) {
    rijen.push(h('div', { class: 'balk-rij' },
      h('div', { class: 'balk-info' }, h('span', {}, 'Er is een nieuwe versie van de app.'),
        h('button', { class: 'balk-knop', onclick: () => { herlaadNaUpdate = true; swWacht.postMessage('nieuwe-versie'); } }, 'Bijwerken'))));
  }
  $balk.replaceChildren(...rijen);
  planSync(t);
}

function terug() {
  const r = route();
  if (r[0] === 'c' && r.length >= 4 && Number(r[3]) > 0) return ga(`#/c/${r[1]}/${r[2]}/${Number(r[3]) - 1}`);
  if (r[0] === 'c' && r.length >= 3) return ga(`#/c/${r[1]}`);
  if (r[0] === 'c' || r[0] === 'nieuw') return ga('#/controles');
  return ga('#/');
}

/** Volgende poging plannen op het moment dat het eerste item weer mag. */
function planSync(t) {
  clearTimeout(syncTimer);
  if (!t.aantal || t.volgende == null) return;
  const wacht = Math.max(1000, t.volgende - Date.now());
  syncTimer = setTimeout(() => sync.verwerk(), wacht);
}

/* ------------------------------------------------------------------ */
/* Tekenen                                                             */
/* ------------------------------------------------------------------ */

async function toon({ behoudScroll = false } = {}) {
  const mijn = ++renderTeller;
  const y = window.scrollY;
  const r = route();
  let inhoud;
  try {
    if (!ingesteld || r[0] === 'instellingen') inhoud = await schermInstellingen();
    else if (r.length === 0) inhoud = await schermStart();
    else if (r[0] === 'controles') inhoud = await schermControles();
    else if (r[0] === 'nieuw') inhoud = await schermNieuw();
    else if (r[0] === 'einde') inhoud = await schermEinde();
    else if (r[0] === 'c') inhoud = await schermControle(r[1], r[2], r[3]);
    else inhoud = [h('p', {}, 'Onbekend scherm.')];
  } catch (e) {
    inhoud = [h('div', { class: 'melding fout' }, `Er ging iets mis: ${e.message}`)];
  }
  if (mijn !== renderTeller) return;
  const kop = melding ? h('div', { class: `melding ${melding.soort}`, id: 'melding', role: 'status' }, melding.tekst) : null;
  // Staat de cursor in een invoerveld, dan staat hij er na het tekenen opnieuw.
  const actief = document.activeElement;
  const veld = actief && $scherm.contains(actief) ? actief.getAttribute('data-invoer') || (actief.id === 'zoek' ? '#zoek' : null) : null;
  const getypt = veld ? actief.value : null;
  $scherm.replaceChildren(...[kop, inhoud].flat(Infinity).filter(Boolean));
  if (veld) {
    const terug = veld === '#zoek' ? document.getElementById('zoek') : $scherm.querySelector(`[data-invoer="${veld}"]`);
    if (terug) {
      if (terug.value !== getypt) terug.value = getypt; // wat op het scherm stond, gaat nooit verloren
      terug.focus({ preventScroll: true });
      try { terug.setSelectionRange(terug.value.length, terug.value.length); } catch (e) { /* type=number kent geen selectie */ }
    }
  }
  window.scrollTo(0, behoudScroll ? y : 0);
  await werkBalkBij();
}

/* ------------------------------------------------------------------ */
/* Instellingen                                                        */
/* ------------------------------------------------------------------ */

async function schermInstellingen() {
  const url = (await db.instelling('url')) || '';
  const sleutel = (await db.instelling('sleutel')) || '';
  const vast = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null;
  const bewaard = await bewaardeBestanden();
  const $url = h('input', { class: 'invoer', id: 'inst-url', type: 'url', value: url, placeholder: 'https://script.google.com/macros/s/…/exec', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const $sleutel = h('input', { class: 'invoer', id: 'inst-sleutel', type: 'password', value: sleutel, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const $uit = h('div', { id: 'inst-uit' });

  async function opslaan() {
    const u = $url.value.trim();
    const s = $sleutel.value.trim();
    if (!/^https?:\/\//i.test(u) || !s) {
      $uit.replaceChildren(h('div', { class: 'melding fout' }, 'Vul het adres van het script (begint met https://) en de sleutel in.'));
      return;
    }
    await db.zetInstelling('url', u);
    await db.zetInstelling('sleutel', s);
    ingesteld = true;
    $uit.replaceChildren(h('div', { class: 'melding info' }, 'Verbinding testen…'));
    try {
      const antwoord = await roep('ping', {}, { timeout: 20000 });
      const gelukt = await ververs({ stil: true });
      if (gelukt) zetMelding('ok', `Verbonden met "${antwoord.sheet}", tabblad "${antwoord.tab}".`, 1);
      else if (melding) melding.over = 1;
      ga('#/');
    } catch (e) {
      $uit.replaceChildren(h('div', { class: 'melding fout', id: 'inst-fout' }, `Opgeslagen, maar de test mislukte: ${e.message}`));
      await werkBalkBij();
    }
  }

  return [
    h('h2', {}, 'Instellingen'),
    !ingesteld ? h('div', { class: 'melding info' }, 'Geef één keer het adres van het script en de sleutel in. Ze blijven op deze tablet bewaard en staan nergens in de app zelf.') : null,
    h('div', { class: 'kaart' },
      h('label', { class: 'veld' }, h('span', {}, 'Adres van het script'), $url),
      h('label', { class: 'veld' }, h('span', {}, 'Sleutel'), $sleutel),
      h('label', { class: 'klein' }, h('input', { type: 'checkbox', onchange: (e) => { $sleutel.type = e.target.checked ? 'text' : 'password'; } }), ' Sleutel tonen'),
      h('div', { class: 'knoppen' }, h('button', { class: 'knop hoofd', id: 'inst-opslaan', onclick: opslaan }, 'Opslaan en testen')),
      $uit),
    h('div', { class: 'kaart klein' },
      h('p', {}, `Versie van de app: ${APP_VERSIE}`),
      h('p', { id: 'inst-offline' }, bewaard === null ? 'App op de tablet bewaard: onbekend' : bewaard >= 13 ? `App op de tablet bewaard: ja (${bewaard} bestanden). Ze start ook zonder verbinding.` : `App op de tablet bewaard: NEE (${bewaard} bestanden). Open de app één keer met verbinding voor je de productiezone ingaat.`),
      h('p', {}, vast === null ? 'Vaste opslag: onbekend' : vast ? 'Vaste opslag: ja, de browser ruimt de gegevens niet zelf op.' : 'Vaste opslag: nee. Installeer de app op het startscherm; dan kent Chrome dit meestal toe.'),
      snapshot ? h('p', {}, `Gegevens van ${dagEnUur(snapshot.opgehaaldOm)}: ${snapshot.orders.length} orders, ${snapshot.pallets.length} pallets.`) : null)
  ];
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

async function schermStart() {
  const controles = await db.alle('controles');
  const vandaag = controles.filter((c) => c.datum === M.vandaag());
  const onaf = controles.filter((c) => M.DELEN.some((d) => isOpenDeel(c.delen[d])));
  return [
    h('h2', {}, datumLang(M.vandaag())),
    !snapshot ? h('div', { class: 'melding wacht' }, 'Er zijn nog geen gegevens opgehaald. Tik bovenaan op "Verversen" zodra er verbinding is.') : null,
    waarschuwingen(),
    h('div', { class: 'tegels' },
      h('button', { class: 'tegel actief', id: 'tegel-controles', onclick: () => ga('#/controles') },
        h('strong', {}, 'Productiecontroles'),
        h('span', { class: 'zacht' }, `${vandaag.length} vandaag${onaf.length ? `, ${onaf.length} onafgewerkt` : ''}`)),
      h('button', { class: 'tegel', disabled: true }, h('strong', {}, 'Werkmaterialen boven'), h('span', { class: 'zacht' }, 'Nog niet in de app (fase 3). Vul in de sheet in.')),
      h('button', { class: 'tegel', disabled: true }, h('strong', {}, 'Magazijn en bufferzone'), h('span', { class: 'zacht' }, 'Nog niet in de app (fase 3). Vul in de sheet in.'))),
    h('div', { class: 'knoppen' }, h('button', { class: 'knop', id: 'naar-einde', onclick: () => ga('#/einde') }, 'Rondgang afsluiten'))
  ];
}

function waarschuwingen() {
  if (!snapshot || !snapshot.waarschuwingen || !snapshot.waarschuwingen.length) return null;
  return h('div', { class: 'melding wacht' }, 'Opmerkingen bij de opgehaalde gegevens:', h('ul', {}, snapshot.waarschuwingen.map((w) => h('li', {}, w))));
}

/* ------------------------------------------------------------------ */
/* Productiecontroles: lijst                                           */
/* ------------------------------------------------------------------ */

function chip(deel, d) {
  return h('span', { class: `chip ${d.status}`, 'data-deel': deel, 'data-status': d.status }, `${M.DEELNAAM[deel]}: ${STATUSTEKST[d.status]}`);
}

function rijControle(c) {
  return h('button', { class: 'rij', 'data-code': c.code, onclick: () => ga(`#/c/${c.appId}`) },
    h('span', { class: 'lijn' }, c.lijn || (c.bron === 'pallet' ? 'Pallet' : '?')),
    h('span', { class: 'rij-tekst' }, h('strong', {}, c.code), h('span', {}, c.opzoek.product || 'Code niet in de lijst')),
    h('span', { class: 'chips' }, M.DELEN.map((d) => chip(d, c.delen[d]))));
}

async function schermControles() {
  const alle = (await db.alle('controles')).sort((a, b) => a.aangemaaktOm - b.aangemaaktOm);
  const vandaag = alle.filter((c) => c.datum === M.vandaag());
  const eerder = alle.filter((c) => c.datum !== M.vandaag() && M.DELEN.some((d) => c.delen[d].status !== 'verzonden'));
  return [
    h('h2', {}, 'Productiecontroles'),
    h('button', { class: 'knop hoofd breed', id: 'nieuwe-controle', onclick: () => { nieuw.gekozen = null; nieuw.zoek = ''; ga('#/nieuw'); } }, '+ Nieuwe controle'),
    h('h2', {}, 'Vandaag'),
    vandaag.length ? vandaag.map(rijControle) : h('p', { class: 'zacht' }, 'Nog geen controles vandaag.'),
    eerder.length ? [h('h2', {}, 'Onafgewerkt van eerdere dagen'), eerder.map((c) => [h('p', { class: 'klein zacht' }, datumLang(c.datum)), rijControle(c)])] : null
  ];
}

/* ------------------------------------------------------------------ */
/* Nieuwe controle                                                     */
/* ------------------------------------------------------------------ */

function opzoekLijst(waarden, sleutels, oud) {
  return h('dl', { class: 'opzoek' }, sleutels.map((k) => [
    h('dt', {}, M.OPZOEKNAAM[k]),
    h('dd', { 'data-opzoek': k },
      oud && (oud[k] || '') !== (waarden[k] || '') ? [h('span', { class: 'verschil' }, oud[k] || '(leeg)'), ' → '] : null,
      waarden[k] || '—')
  ]));
}

async function schermNieuw() {
  if (!snapshot) return [h('h2', {}, 'Nieuwe controle'), h('div', { class: 'melding wacht' }, 'Haal eerst de gegevens op met "Verversen". Zonder gegevens kent de app de keuzelijsten van de sheet niet.')];
  const controles = await db.alle('controles');
  const $lijst = h('div', { id: 'zoek-lijst' });
  const $keuze = h('div', { id: 'gekozen' });

  function bron() { return nieuw.tab === 'order' ? snapshot.orders : snapshot.pallets; }

  function tekenLijst() {
    const z = nieuw.zoek.trim().toLowerCase();
    let items = bron();
    if (nieuw.tab === 'order' && nieuw.lijn) items = items.filter((o) => o.lijn === nieuw.lijn);
    if (z) items = items.filter((o) => String(o.code).toLowerCase().includes(z) || String(o.product).toLowerCase().includes(z));
    const getoond = items.slice(0, 60);
    $lijst.replaceChildren(...[
      getoond.map((o) => h('button', { class: 'rij', 'data-code': o.code, onclick: () => kies(String(o.code)) },
        h('span', { class: 'lijn' }, nieuw.tab === 'order' ? o.lijn || '?' : 'Pallet'),
        h('span', { class: 'rij-tekst' }, h('strong', {}, o.code), h('span', {}, o.product)),
        h('span', { class: 'chip' }, o.status || o.toestand || ''))),
      items.length > getoond.length ? h('p', { class: 'klein zacht' }, `Nog ${items.length - getoond.length} meer. Zoek op code om te verfijnen.`) : null,
      !items.length ? h('div', { class: 'kaart', id: 'niet-gevonden' },
        h('p', {}, z ? `Geen ${nieuw.tab === 'order' ? 'order' : 'pallet'} gevonden voor "${nieuw.zoek.trim()}".` : 'Geen items in deze lijst.'),
        h('div', { class: 'knoppen' },
          h('button', { class: 'knop', id: 'zoek-ververs', onclick: () => ververs() }, 'Gegevens verversen'),
          z ? h('button', { class: 'knop', id: 'code-intypen', onclick: () => kies(nieuw.zoek.trim()) }, `Code "${nieuw.zoek.trim()}" intypen`) : null)) : null
    ].flat(Infinity).filter(Boolean));
  }

  function tekenKeuze() {
    if (!nieuw.gekozen) { $keuze.replaceChildren(); return; }
    const code = nieuw.gekozen;
    const treffer = M.zoekCode(snapshot, code);
    const bestaand = controles.find((c) => c.code === code && c.datum === M.vandaag());
    const waarden = {};
    M.OPZOEKVELDEN.forEach((k) => { waarden[k] = treffer ? treffer.item[k] || '' : ''; });
    $keuze.replaceChildren(h('div', { class: 'kaart blok-boven', id: 'keuze-kaart' },
      h('h3', {}, `${treffer && treffer.item.lijn ? treffer.item.lijn + ' · ' : ''}${code}`),
      treffer ? opzoekLijst(waarden, M.OPZOEKVELDEN) : h('div', { class: 'melding wacht' }, 'Deze code staat niet in de opgehaalde gegevens. De app kan product en lot niet tonen; de sheet vult ze zelf aan.'),
      bestaand ? h('div', { class: 'melding wacht', id: 'bestaat-al' }, 'Er bestaat vandaag al een controle voor deze code.',
        h('div', { class: 'knoppen' }, h('button', { class: 'knop', onclick: () => ga(`#/c/${bestaand.appId}`) }, 'Bestaande controle openen'))) : null,
      h('p', { class: 'klein zacht' }, bestaand ? 'Toch een nieuwe controle starten met:' : 'Met welk deel begin je?'),
      h('div', { class: 'knoppen' },
        h('button', { class: 'knop hoofd', id: 'start-boven', onclick: () => maak(code, treffer, 'boven') }, 'Boven'),
        h('button', { class: 'knop hoofd', id: 'start-beneden', onclick: () => maak(code, treffer, 'beneden') }, 'Beneden'),
        h('button', { class: 'knop', onclick: () => { nieuw.gekozen = null; tekenKeuze(); } }, 'Annuleren'))));
    $keuze.scrollIntoView({ block: 'start' });
  }

  function kies(code) {
    if (!code) return;
    nieuw.gekozen = code;
    tekenKeuze();
  }

  async function maak(code, treffer, deel) {
    const c = M.nieuweControle(code, treffer ? treffer.item : null, treffer ? treffer.bron : 'vrij');
    await db.zet('controles', c);
    nieuw.gekozen = null;
    nieuw.zoek = '';
    ga(`#/c/${c.appId}/${deel}/0`);
  }

  const lijnen = [...new Set(snapshot.orders.map((o) => o.lijn).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'nl', { numeric: true }));
  const $filter = h('div', { class: 'filter', id: 'lijn-filter' });
  function tekenFilter() {
    $filter.replaceChildren(...(nieuw.tab !== 'order' ? [] : [
      h('button', { class: nieuw.lijn === '' ? 'aan' : '', onclick: () => { nieuw.lijn = ''; tekenFilter(); tekenLijst(); } }, 'Alle lijnen'),
      ...lijnen.map((l) => h('button', { class: nieuw.lijn === l ? 'aan' : '', 'data-lijn': l, onclick: () => { nieuw.lijn = l; tekenFilter(); tekenLijst(); } }, l))
    ]));
  }
  const $tabs = h('div', { class: 'filter' });
  function tekenTabs() {
    $tabs.replaceChildren(
      h('button', { class: nieuw.tab === 'order' ? 'aan' : '', id: 'tab-orders', onclick: () => { nieuw.tab = 'order'; tekenTabs(); tekenFilter(); tekenLijst(); } }, `Orders (${snapshot.orders.length})`),
      h('button', { class: nieuw.tab === 'pallet' ? 'aan' : '', id: 'tab-pallets', onclick: () => { nieuw.tab = 'pallet'; tekenTabs(); tekenFilter(); tekenLijst(); } }, `Pallets (${snapshot.pallets.length})`));
  }
  const $zoek = h('input', { class: 'invoer', id: 'zoek', type: 'search', placeholder: 'Zoek op code of product', value: nieuw.zoek, autocomplete: 'off', oninput: (e) => { nieuw.zoek = e.target.value; tekenLijst(); } });

  tekenTabs(); tekenFilter(); tekenLijst(); tekenKeuze();
  return [h('h2', {}, 'Nieuwe controle'), $keuze, $tabs, $zoek, $filter, $lijst];
}

/* ------------------------------------------------------------------ */
/* Eén controle                                                        */
/* ------------------------------------------------------------------ */

function kopControle(c) {
  return h('div', { class: 'kaart', id: 'kop-controle' },
    h('h3', {}, `${c.lijn ? c.lijn + ' · ' : ''}${c.code}`),
    h('p', {}, c.opzoek.product || (c.bron === 'vrij' ? 'Code niet in de opgehaalde gegevens' : '')),
    h('p', { class: 'klein zacht' }, datumLang(c.datum)));
}

function wijzigingBanner(c) {
  if (!c.wijziging) return null;
  const gewijzigd = M.OPZOEKVELDEN.filter((k) => (c.wijziging.oud[k] || '') !== (c.opzoek[k] || ''));
  if (!gewijzigd.length) return null;
  return h('div', { class: 'melding wacht', id: 'wijziging' },
    h('strong', {}, `De gegevens van deze order zijn gewijzigd bij het verversen van ${dagEnUur(c.wijziging.om)}.`),
    opzoekLijst(c.opzoek, gewijzigd, c.wijziging.oud),
    h('div', { class: 'knoppen' }, h('button', { class: 'knop', id: 'wijziging-gezien', onclick: async () => {
      await db.werkBij('controles', c.appId, (x) => { x.wijziging = null; });
      toon({ behoudScroll: true });
    } }, 'Gezien')));
}

/** Vast blok bij Beneden: wat er bij Boven ingevuld is. */
function blokBoven(c) {
  const b = c.delen.boven;
  if (b.status === 'open') {
    return h('div', { class: 'melding wacht', id: 'blok-boven' }, h('strong', {}, 'Boven is nog niet gecontroleerd voor deze order.'));
  }
  const gezien = b.gezien || c.opzoek;
  const regel = (naam, waarde) => [h('dt', {}, naam), h('dd', {}, waarde)];
  return h('div', { class: 'kaart blok-boven', id: 'blok-boven' },
    h('h3', {}, b.status === 'bezig' ? 'Boven: begonnen, nog niet afgesloten' : `Boven: afgesloten om ${uur(b.afgeslotenOm)}`),
    h('dl', { class: 'opzoek' },
      regel('Grondstof', gezien.grondstof || '—'),
      regel('LOT GRD', gezien.lotGrd || '—'),
      regel(M.label('grdCorrect', snapshot), toonAntwoord('grdCorrect', b.antwoorden)),
      regel('Allergenen', gezien.allergenen || '—'),
      regel(M.label('allergeenEtiket', snapshot), toonAntwoord('allergeenEtiket', b.antwoorden)),
      regel(M.label('trechter', snapshot), toonAntwoord('trechter', b.antwoorden)),
      regel('Orde en netheid', toonAntwoord('ordeNetheid', b.antwoorden)),
      regel('Opmerkingen boven', b.antwoorden.opmBoven || '—')));
}

/** Verwijderen kan alleen zolang zeker niets van deze controle in de sheet staat. */
function magVerwijderd(c) {
  return M.DELEN.every((d) => { const x = c.delen[d]; return x.status !== 'verzonden' && !x.rij && !x.verzondenOm && !x.geprobeerd; });
}

async function schermControle(appId, deel, groep) {
  const c = await db.haal('controles', appId);
  if (!c) return [h('div', { class: 'melding fout' }, 'Deze controle bestaat niet (meer) op deze tablet.')];
  if (deel === 'boven' || deel === 'beneden') {
    return isOpenDeel(c.delen[deel]) ? schermDeel(c, deel, Number(groep) || 0) : schermSamenvatting(c, deel);
  }

  const magWeg = magVerwijderd(c);
  const $weg = h('div', { class: 'knoppen' });
  function tekenWeg() {
    const zeker = bevestigWeg === c.appId;
    $weg.replaceChildren(...[!magWeg ? h('p', { class: 'klein zacht' }, 'Deze controle is al (deels) naar de sheet verzonden en kan hier niet meer verwijderd worden. Verbeter ze met Corrigeren of in de sheet.')
      : zeker ? [h('button', { class: 'knop gevaar hoofd', id: 'verwijder-ja', onclick: async () => {
        // Nakijken en wissen in één stap: begint de synchronisatie net op dit
        // moment te verzenden, dan gaat het verwijderen niet door.
        const gewist = await db.wisAls('controles', c.appId, magVerwijderd);
        bevestigWeg = null;
        if (!gewist) { zetMelding('fout', 'Deze controle is intussen verzonden en kan niet meer verwijderd worden.'); return toon(); }
        for (const d of M.DELEN) await sync.uitWachtrij(c.appId, d);
        ga('#/controles');
      } }, 'Ja, verwijderen'), h('button', { class: 'knop', onclick: () => { bevestigWeg = null; tekenWeg(); } }, 'Nee, behouden')]
        : h('button', { class: 'knop gevaar', id: 'verwijder', onclick: () => { bevestigWeg = c.appId; tekenWeg(); } }, 'Controle verwijderen')].flat());
  }
  tekenWeg();

  const deelKaart = (d) => {
    const st = c.delen[d];
    const tekst = st.status === 'open' ? `${M.DEELNAAM[d]} starten` : st.status === 'bezig' ? `${M.DEELNAAM[d]} verderzetten` : `${M.DEELNAAM[d]} bekijken`;
    return h('div', { class: 'kaart' },
      h('div', { class: 'balk-rij' }, h('h3', { style: 'flex:1' }, M.DEELNAAM[d]), chip(d, st)),
      st.afgeslotenOm && !isOpenDeel(st) ? h('p', { class: 'klein zacht' }, `Afgesloten om ${dagEnUur(st.afgeslotenOm)}${st.rij ? `, rij ${st.rij} in de sheet` : ''}`) : null,
      h('div', { class: 'knoppen' }, h('button', { class: `knop ${isOpenDeel(st) ? 'hoofd' : ''}`, id: `open-${d}`, onclick: () => ga(`#/c/${c.appId}/${d}/0`) }, tekst)));
  };

  return [
    kopControle(c),
    wijzigingBanner(c),
    c.bron !== 'vrij' ? h('div', { class: 'kaart' }, opzoekLijst(c.opzoek, M.OPZOEKVELDEN)) : null,
    M.DELEN.map(deelKaart),
    $weg
  ];
}

/* ------------------------------------------------------------------ */
/* Een deel invullen                                                   */
/* ------------------------------------------------------------------ */

async function bewaar(appId, deel, id, waarde, { teken = true } = {}) {
  try {
    await db.werkBij('controles', appId, (c) => {
      const d = c.delen[deel];
      if (!isOpenDeel(d)) return false;
      M.zetAntwoord(d.antwoorden, id, waarde);
      d.status = 'bezig';
    });
  } catch (e) {
    // Mag nooit stil gebeuren: de controleur moet weten dat dit antwoord niet bewaard is.
    zetMelding('fout', `Bewaren op de tablet mislukte: ${e && e.message ? e.message : e}. Dit antwoord is NIET bewaard.`);
    teken = true;
  }
  if (teken) await toon({ behoudScroll: true });
}

function punt(c, deel, id, open) {
  const v = M.VELDEN[id];
  const antwoorden = c.delen[deel].antwoorden;
  const a = antwoorden[id];
  const volledig = M.label(id, snapshot);
  const knip = volledig.indexOf(':');
  const titel = knip > 0 && knip < 40 ? volledig.slice(0, knip) : volledig;
  const hulp = knip > 0 && knip < 40 ? volledig.slice(knip + 1).trim() : '';
  const el = h('section', { class: `punt${open ? ' open' : ''}`, 'data-veld': id }, h('h3', {}, titel), hulp ? h('p', { class: 'hulp' }, hulp) : null);

  if (M.isVervallen(id, antwoorden)) {
    el.classList.add('vervallen');
    el.append(h('div', { class: 'nvt-auto' }, 'NVT (automatisch)'),
      h('p', { class: 'hulp' }, `Wordt niet gevraagd omdat "${M.label(v.nvtAls, snapshot)}" op NEE staat.`));
    return el;
  }
  if (v.soort === 'tekst') {
    el.append(h('textarea', { class: 'invoer', 'data-invoer': id, rows: 3, placeholder: 'Verplicht bij een NOK of STOP', oninput: (e) => bewaar(c.appId, deel, id, e.target.value, { teken: false }) }, a || ''));
    return el;
  }
  if (v.soort === 'getal') {
    el.append(h('input', { class: 'invoer', 'data-invoer': id, type: 'number', inputmode: 'decimal', step: 'any', min: '0', value: a === undefined ? '' : a,
      oninput: (e) => bewaar(c.appId, deel, id, e.target.value === '' ? undefined : e.target.value, { teken: false }) }));
    return el;
  }
  const ks = M.keuzes(id, snapshot);
  if (!ks) {
    el.append(h('div', { class: 'melding fout' }, 'Voor deze kolom is in de sheet geen keuzelijst gevonden. Ververs de gegevens of kijk de gegevensvalidatie van de kolom na.'));
    return el;
  }
  el.append(h('div', { class: `keuzes${ks.length > 5 ? ' veel' : ''}` }, ks.map((k) =>
    h('button', { class: `keuze ${kleurKlasse(k)}${a !== undefined && a === k.waarde ? ' gekozen' : ''}`, 'data-waarde': String(k.waarde), 'aria-pressed': a !== undefined && a === k.waarde ? 'true' : 'false',
      onclick: () => bewaar(c.appId, deel, id, k.waarde) }, k.tekst))));
  return el;
}

async function schermDeel(c, deel, gi) {
  const groepen = M.GROEPEN[deel];
  gi = Math.min(Math.max(gi, 0), groepen.length - 1);
  const g = groepen[gi];
  const d = c.delen[deel];
  const open = toonOpen ? M.openPunten(deel, d.antwoorden, gi) : [];
  const laatste = gi === groepen.length - 1;

  async function verder() {
    const vers = await db.haal('controles', c.appId);
    const antw = vers.delen[deel].antwoorden;
    if (M.openPunten(deel, antw, gi).length) {
      toonOpen = true;
      await toon({ behoudScroll: true });
      const eerste = document.querySelector('.punt.open');
      if (eerste) eerste.scrollIntoView({ block: 'center' });
      return;
    }
    if (!laatste) return ga(`#/c/${c.appId}/${deel}/${gi + 1}`);
    // Afsluiten: ook de vorige groepen nakijken.
    const elders = groepen.findIndex((_, i) => M.openPunten(deel, antw, i).length);
    if (elders !== -1) return ga(`#/c/${c.appId}/${deel}/${elders}`, { markeerOpen: true });
    await db.werkBij('controles', c.appId, (x) => {
      const dx = x.delen[deel];
      dx.status = 'klaar';
      dx.versie += 1;
      dx.afgeslotenOm = new Date().toISOString();
      // Wat de controleur zag, vastgelegd op het moment van afsluiten.
      dx.gezien = x.bron === 'vrij' ? null : Object.fromEntries(M.GEZIEN[deel].map((k) => [k, x.opzoek[k] || '']));
    });
    await sync.inWachtrij(c.appId, deel);
    sync.verwerk();
    zetMelding('ok', `${M.DEELNAAM[deel]} is afgesloten voor ${c.code}.`, 1);
    ga(`#/c/${c.appId}`);
  }

  return [
    kopControle(c),
    deel === 'beneden' ? blokBoven(c) : null,
    wijzigingBanner(c),
    h('h2', {}, `${M.DEELNAAM[deel]}: ${g.titel}`),
    h('p', { class: 'stap' }, `Stap ${gi + 1} van ${groepen.length}`),
    g.toon.length && c.bron !== 'vrij' ? h('div', { class: 'kaart' }, opzoekLijst(c.opzoek, g.toon)) : null,
    open.length ? h('div', { class: 'melding fout', id: 'open-melding' }, `Nog ${open.length} ${open.length === 1 ? 'punt' : 'punten'} open. Elk punt vraagt een antwoord${open.includes(M.OPMERKING[deel]) ? '; een NOK of STOP vraagt een opmerking' : ''}.`) : null,
    g.velden.map((id) => punt(c, deel, id, open.includes(id))),
    h('div', { class: 'onderbalk' },
      gi > 0 ? h('button', { class: 'knop', id: 'vorige', onclick: () => ga(`#/c/${c.appId}/${deel}/${gi - 1}`) }, 'Vorige') : null,
      h('button', { class: 'knop hoofd', id: 'verder', onclick: verder }, laatste ? `${M.DEELNAAM[deel]} afsluiten` : 'Volgende'))
  ];
}

async function schermSamenvatting(c, deel) {
  const d = c.delen[deel];
  const magCorrigeren = c.datum === M.vandaag();
  return [
    kopControle(c),
    deel === 'beneden' ? blokBoven(c) : null,
    h('h2', {}, `${M.DEELNAAM[deel]}: ${STATUSTEKST[d.status]}`),
    h('p', { class: 'stap' }, `Afgesloten om ${dagEnUur(d.afgeslotenOm)}`),
    h('div', { class: 'kaart' }, h('table', { class: 'samenvatting' }, h('tbody', {}, M.veldenVan(deel).map((id) =>
      h('tr', { 'data-veld': id }, h('td', {}, M.label(id, snapshot).split(':')[0]), h('td', {}, toonAntwoord(id, d.antwoorden))))))),
    h('div', { class: 'knoppen' },
      h('button', { class: 'knop hoofd', onclick: () => ga(`#/c/${c.appId}`) }, 'Terug naar de controle'),
      magCorrigeren ? h('button', { class: 'knop', id: 'corrigeren', onclick: async () => {
        await db.werkBij('controles', c.appId, (x) => { x.delen[deel].status = 'bezig'; x.delen[deel].versie += 1; });
        await sync.uitWachtrij(c.appId, deel);
        ga(`#/c/${c.appId}/${deel}/0`);
      } }, 'Corrigeren') : null),
    !magCorrigeren ? h('p', { class: 'klein zacht' }, 'Corrigeren in de app kan alleen op de dag van de controle. Latere correcties gebeuren in de sheet.') : null
  ];
}

/* ------------------------------------------------------------------ */
/* Einde van de rondgang                                               */
/* ------------------------------------------------------------------ */

async function schermEinde() {
  const t = await sync.toestand();
  const controles = (await db.alle('controles')).filter((c) => c.datum === M.vandaag());
  const onaf = controles.filter((c) => M.DELEN.some((d) => isOpenDeel(c.delen[d])));
  const alle = await db.alle('controles');
  const groen = t.aantal === 0 && !alle.some((c) => M.DELEN.some((d) => c.delen[d].status === 'klaar'));
  return [
    h('div', { class: `eind${groen ? ' groen' : ''}`, id: 'eind', 'data-groen': String(groen) },
      h('strong', {}, groen ? 'Alles verzonden' : 'Nog niet alles verzonden'),
      groen ? `${controles.length} ${controles.length === 1 ? 'controle' : 'controles'} vandaag. De tablet mag weg.`
        : `${t.controles} ${t.controles === 1 ? 'controle wacht' : 'controles wachten'} op verzenden. Hou de app open tot dit scherm groen is.`),
    !groen && t.fout ? h('div', { class: 'melding fout' }, `Laatste fout: ${t.fout}`) : null,
    !groen ? h('div', { class: 'knoppen' }, h('button', { class: 'knop hoofd', onclick: () => sync.verwerk({ handmatig: true }) }, 'Nu synchroniseren')) : null,
    onaf.length ? [h('div', { class: 'melding wacht', id: 'onafgewerkt' }, `${onaf.length} ${onaf.length === 1 ? 'controle is' : 'controles zijn'} niet volledig ingevuld:`), onaf.map(rijControle)] : null
  ];
}

/* ------------------------------------------------------------------ */
/* Gegevens verversen                                                  */
/* ------------------------------------------------------------------ */

async function ververs({ stil = false } = {}) {
  if (verversBezig) return false;
  verversBezig = true;
  let gelukt = false;
  await werkBalkBij();
  try {
    const s = await roep('snapshot', {}, { timeout: SNAPSHOT_WACHT_MS });
    if (!Array.isArray(s.orders) || !Array.isArray(s.pallets) || !s.velden || !Object.keys(s.velden).length) {
      throw new Error((s.waarschuwingen && s.waarschuwingen.join(' ')) || 'Onvolledige gegevens ontvangen.');
    }
    // Zonder keuzelijst kan een punt niet beantwoord worden: zo'n snapshot wordt niet gebruikt.
    const zonder = Object.keys(M.VELDEN).filter((id) => M.VELDEN[id].soort === 'keuze' && !M.VELDEN[id].reserve && !(s.velden[id] && s.velden[id].keuzes && s.velden[id].keuzes.length));
    if (zonder.length) throw new Error(`In de sheet ontbreekt de keuzelijst voor: ${zonder.map((id) => M.label(id, s)).join(', ')}.`);
    // Pas na een volledig antwoord wordt de vorige snapshot vervangen.
    const vers = { orders: s.orders, pallets: s.pallets, velden: s.velden, waarschuwingen: s.waarschuwingen || [], bron: s.bron || {}, opgehaaldOm: Date.now() };
    await db.zet('referentie', vers, 'snapshot');
    snapshot = vers;
    await pasOpenControlesAan();
    gelukt = true;
    if (!stil) zetMelding('ok', `Gegevens ververst om ${uur(vers.opgehaaldOm)}.`);
  } catch (e) {
    zetMelding('fout', snapshot
      ? `Verversen mislukt, gegevens van ${dagEnUur(snapshot.opgehaaldOm)} blijven in gebruik. (${e.message})`
      : `Gegevens ophalen mislukt. (${e.message})`);
  } finally {
    verversBezig = false;
  }
  await toon({ behoudScroll: true });
  return gelukt;
}

/** Open controles nemen de nieuwe waarden over; een verschil wordt getoond. Ingevulde antwoorden blijven onaangeroerd. */
async function pasOpenControlesAan() {
  for (const c of await db.alle('controles')) {
    if (!M.DELEN.some((d) => isOpenDeel(c.delen[d]))) continue;
    const treffer = M.zoekCode(snapshot, c.code);
    if (!treffer) continue;
    const vers = {};
    M.OPZOEKVELDEN.forEach((k) => { vers[k] = treffer.item[k] || ''; });
    const verschil = M.OPZOEKVELDEN.some((k) => vers[k] !== (c.opzoek[k] || ''));
    if (!verschil && c.bron !== 'vrij' && c.lijn === (treffer.item.lijn || '')) continue;
    await db.werkBij('controles', c.appId, (x) => {
      if (x.bron !== 'vrij' && verschil) x.wijziging = { oud: x.wijziging ? x.wijziging.oud : { ...x.opzoek }, om: Date.now() };
      x.opzoek = vers;
      x.bron = treffer.bron;
      x.lijn = treffer.item.lijn || '';
    });
  }
}

/* ------------------------------------------------------------------ */
/* Opstarten                                                           */
/* ------------------------------------------------------------------ */

/**
 * Na 14 dagen opruimen wat verzonden is. Een deel dat nog wacht op verzenden of
 * waar antwoorden in staan die niet afgesloten zijn, blijft altijd staan.
 */
async function opruimen() {
  const grens = Date.now() - 14 * 24 * 60 * 60 * 1000;
  for (const c of await db.alle('controles')) {
    const veilig = M.DELEN.every((d) => c.delen[d].status === 'verzonden' || c.delen[d].status === 'open');
    if (veilig && c.aangemaaktOm < grens) await db.wis('controles', c.appId);
  }
}

/** Vraagt de service worker om ontbrekende bestanden opnieuw op te halen. */
async function controleerCache() {
  if (!('serviceWorker' in navigator) || !navigator.onLine) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg.active) reg.active.postMessage('controleer-cache');
  } catch (e) { /* geen service worker */ }
}

/** Hoeveel bestanden van de app staan op de tablet? Voor het instelscherm. */
async function bewaardeBestanden() {
  try {
    if (!('caches' in window)) return null;
    const naam = `qc-rondgang-${APP_VERSIE}`;
    if (!(await caches.has(naam))) return 0;
    return (await (await caches.open(naam)).keys()).length;
  } catch (e) { return null; }
}

async function registreerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js', { type: 'module', updateViaCache: 'none' });
    const kijk = () => {
      if (reg.waiting && navigator.serviceWorker.controller) { swWacht = reg.waiting; werkBalkBij(); }
    };
    kijk();
    reg.addEventListener('updatefound', () => {
      if (reg.installing) reg.installing.addEventListener('statechange', kijk);
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (herlaadNaUpdate) location.reload(); });
    controleerCache();
  } catch (e) {
    console.warn('Service worker niet geregistreerd:', e);
  }
}

async function start() {
  ingesteld = !!((await db.instelling('url')) && (await db.instelling('sleutel')));
  snapshot = (await db.haal('referentie', 'snapshot')) || null;

  // Bij elke start opnieuw vragen zolang het niet toegekend is: Chrome zegt
  // meestal pas ja nadat de app op het startscherm geïnstalleerd is.
  if (navigator.storage && navigator.storage.persist) {
    try { if (!(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (e) { /* niet erg */ }
  }
  await opruimen();
  await sync.herstelWachtrij();
  registreerServiceWorker();

  window.addEventListener('hashchange', () => {
    toonOpen = toonOpenNa;
    toonOpenNa = false;
    bevestigWeg = null;
    // Een melding hoort bij het scherm waar ze getoond werd.
    if (melding) { if (melding.over > 0) melding.over -= 1; else melding = null; }
    toon();
  });
  window.addEventListener('online', () => { werkBalkBij(); sync.verwerk({ handmatig: true }); controleerCache(); });
  window.addEventListener('offline', () => werkBalkBij());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync.verwerk(); });
  setInterval(() => sync.verwerk(), 60 * 1000);

  if ('BroadcastChannel' in window) {
    new BroadcastChannel('qc-rondgang').onmessage = () => {
      const r = route();
      // Lijsten en overzichten tonen de status van de delen: opnieuw tekenen.
      // Invulschermen niet, anders verliest een tekstveld de cursor.
      const overzicht = ingesteld && (r.length === 0 || r[0] === 'controles' || r[0] === 'einde' || (r[0] === 'c' && r.length === 2));
      if (overzicht) toon({ behoudScroll: true }); else werkBalkBij();
    };
  }

  await toon();

  if (ingesteld && navigator.onLine) {
    const oud = !snapshot || M.vandaag(new Date(snapshot.opgehaaldOm)) !== M.vandaag();
    if (oud) ververs({ stil: true });
    sync.verwerk();
  }
}

start();
