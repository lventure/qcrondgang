/**
 * QC Rondgang - backend (fase 1)
 * Apps Script, gebonden aan de sheet "QC Productie dagelijkse rondgang".
 *
 * Wat dit script doet:
 *   - ping      : nakijken of adres en sleutel kloppen
 *   - snapshot  : orders, pallets en keuzelijsten ophalen
 *   - controle  : een deel (Boven of Beneden) van een controle wegschrijven
 *
 * Wat dit script NIET doet: foto's (fase 2) en de twee dagtabbladen (fase 3).
 *
 * Eenmalig: voer installeer() uit vanuit de editor. Daarna implementeren als
 * web-app (Uitvoeren als: ik, Toegang: Iedereen). Zie LEESMIJ.md.
 *
 * In deze code staan geen sleutels, geen spreadsheet-ID's en geen klant- of
 * productnamen. De sleutel staat in de Script Properties (SLEUTEL). De ID's van
 * de bronsheets leest het script uit de IMPORTRANGE-formules van de sheet zelf.
 */

const INST = {
  // Naam van het hoofdtabblad. Te overschrijven met Script Property TAB_QC
  // (nodig bij de overstap naar de echte sheet in fase 4).
  TAB_QC: 'TEST_Auto Verkorte kwaliteitscontrole productie',
  TAB_IMPORT_ORDERS: 'ImportProductielijst',
  TAB_IMPORT_PALLETS: 'poco list',
  KOPRIJ: 2,
  EERSTE_RIJ: 3,
  // Statussen die NIET opgehaald worden (exacte waarde, hoofdletters genegeerd).
  ORDER_UIT: ['klaar'],
  PALLET_UIT: ['klaar', 'niet gebruikt', 'shipped', 'vernietigd'],
  WACHT_OP_SLOT_MS: 20000,
  VERSIE: '1.0.0'
};

/**
 * Alle kolommen waar het script iets mee doet. Een kolom wordt gezocht op de
 * tekst van zijn kop in rij 2 (spaties en hoofdletters genegeerd), niet op zijn
 * letter. Schuift er een kolom op, dan blijft het script juist schrijven. Wordt
 * een kop hernoemd, dan weigert het script te schrijven en zegt het welke kop
 * ontbreekt.
 *
 * soort: 'vakje' (selectievakje), 'lijst' (keuzelijst), 'getal', 'tekst'
 * nde  : de hoeveelste kolom met die kop (voor de twee kolommen "Operator")
 * nvtAls: het veld waarvan dit punt afhangt (NEE daar = automatisch NVT hier)
 */
const VELDEN = [
  { id: 'tijdstempel', deel: 'gemeen', kop: /^tijdstempel/ },
  { id: 'code', deel: 'gemeen', kop: /^productiecode/ },

  { id: 'lotZkCorrect', deel: 'beneden', soort: 'vakje', kop: /^lotzkcorrect/ },
  { id: 'allergenenCorrect', deel: 'beneden', soort: 'vakje', kop: /^allergenencorrect/ },
  { id: 'operator1', deel: 'beneden', soort: 'lijst', kop: /^operator/, nde: 1 },
  { id: 'operator2', deel: 'beneden', soort: 'lijst', kop: /^operator/, nde: 2 },
  { id: 'checkweger', deel: 'beneden', soort: 'lijst', kop: /^checkweger/ },
  { id: 'cwGewicht', deel: 'beneden', soort: 'lijst', kop: /^gewichtcheckw/, nvtAls: 'checkweger' },
  { id: 'cwPlus', deel: 'beneden', soort: 'lijst', kop: /^controle\+1/, nvtAls: 'checkweger' },
  { id: 'cwMin', deel: 'beneden', soort: 'lijst', kop: /^controle-1/, nvtAls: 'checkweger' },
  { id: 'metaaldetector', deel: 'beneden', soort: 'lijst', kop: /^metaal-?detector/ },
  { id: 'mdUitworp', deel: 'beneden', soort: 'lijst', kop: /^uitworp/, nvtAls: 'metaaldetector' },
  { id: 'monoDuo', deel: 'beneden', soort: 'getal', kop: /^mono/ },
  { id: 'snelheid', deel: 'beneden', soort: 'getal', kop: /^snelheid/ },
  { id: 'opmBeneden', deel: 'beneden', soort: 'tekst', kop: /^opmerkingenbeneden/ },
  { id: 'cProduct', deel: 'beneden', soort: 'lijst', kop: /^product:/ },
  { id: 'cHoudbaarheid', deel: 'beneden', soort: 'lijst', kop: /^houdbaarheid:/ },
  { id: 'cGewicht', deel: 'beneden', soort: 'lijst', kop: /^gewicht:/ },
  { id: 'cZk', deel: 'beneden', soort: 'lijst', kop: /^zk:/ },
  { id: 'cDi', deel: 'beneden', soort: 'lijst', kop: /^di:/ },
  { id: 'cDs', deel: 'beneden', soort: 'lijst', kop: /^ds\/pallet/ },
  { id: 'cEtiket', deel: 'beneden', soort: 'lijst', kop: /^etiket:/ },
  { id: 'cDocumenten', deel: 'beneden', soort: 'lijst', kop: /^documenten/ },
  { id: 'cAllergenen', deel: 'beneden', soort: 'lijst', kop: /^allergenenbeleid/ },

  { id: 'grdCorrect', deel: 'boven', soort: 'vakje', kop: /^grdcorrect/ },
  { id: 'allergeenEtiket', deel: 'boven', soort: 'vakje', kop: /^allergenetiket/ },
  { id: 'trechter', deel: 'boven', soort: 'lijst', kop: /^trechter/ },
  { id: 'ordeNetheid', deel: 'boven', soort: 'lijst', kop: /^geslotencircuits/ },
  { id: 'opmBoven', deel: 'boven', soort: 'tekst', kop: /^opmerkingenboven/ },

  // Kolommen die installeer() toevoegt.
  { id: 'appId', deel: 'gemeen', kop: /^app-id$/, nieuw: 'App-ID' },
  { id: 'bovenOm', deel: 'boven', kop: /^bovengecontroleerdom$/, nieuw: 'Boven gecontroleerd om', tijd: true },
  { id: 'benedenOm', deel: 'beneden', kop: /^benedengecontroleerdom$/, nieuw: 'Beneden gecontroleerd om', tijd: true },
  { id: 'ontvangenOm', deel: 'gemeen', kop: /^ontvangenom$/, nieuw: 'Ontvangen om', tijd: true },
  { id: 'gezienProduct', deel: 'beneden', kop: /^gezien:product$/, nieuw: 'Gezien: product', gezien: 'product' },
  { id: 'gezienLotZk', deel: 'beneden', kop: /^gezien:lotzk$/, nieuw: 'Gezien: LOT ZK', gezien: 'lotZk' },
  { id: 'gezienAllergenenBeneden', deel: 'beneden', kop: /^gezien:allergenen\(beneden\)$/, nieuw: 'Gezien: allergenen (beneden)', gezien: 'allergenen' },
  { id: 'gezienGrondstof', deel: 'boven', kop: /^gezien:grondstof$/, nieuw: 'Gezien: grondstof', gezien: 'grondstof' },
  { id: 'gezienLotGrd', deel: 'boven', kop: /^gezien:lotgrd$/, nieuw: 'Gezien: LOT GRD', gezien: 'lotGrd' },
  { id: 'gezienAllergenenBoven', deel: 'boven', kop: /^gezien:allergenen\(boven\)$/, nieuw: 'Gezien: allergenen (boven)', gezien: 'allergenen' }
];

/* ------------------------------------------------------------------ */
/* Ingang                                                              */
/* ------------------------------------------------------------------ */

function doPost(e) {
  let uit;
  try {
    const verzoek = JSON.parse(e.postData.contents);
    uit = verwerk_(verzoek);
  } catch (err) {
    uit = { ok: false, code: 'FOUT', fout: String((err && err.message) || err) };
  }
  return json_(uit);
}

function doGet() {
  // Bewust niets: geen pagina, geen gegevens.
  return json_({ ok: false, code: 'POST', fout: 'Deze web-app aanvaardt alleen POST.' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function verwerk_(verzoek) {
  const sleutel = PropertiesService.getScriptProperties().getProperty('SLEUTEL');
  if (!sleutel || !verzoek || verzoek.sleutel !== sleutel) {
    return { ok: false, code: 'SLEUTEL', fout: 'Sleutel geweigerd.' };
  }
  switch (verzoek.actie) {
    case 'ping':
      return { ok: true, sheet: SpreadsheetApp.getActiveSpreadsheet().getName(), tab: tabNaam_(), scriptVersie: INST.VERSIE, om: new Date().toISOString() };
    case 'snapshot':
      return snapshot_();
    case 'controle':
      return controle_(verzoek);
    default:
      return { ok: false, code: 'ACTIE', fout: 'Onbekende actie: ' + verzoek.actie };
  }
}

/* ------------------------------------------------------------------ */
/* Hulpfuncties                                                        */
/* ------------------------------------------------------------------ */

function tabNaam_() {
  return PropertiesService.getScriptProperties().getProperty('TAB_QC') || INST.TAB_QC;
}

function qcTab_() {
  const naam = tabNaam_();
  const tab = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(naam);
  if (!tab) throw new Error('Tabblad niet gevonden: ' + naam);
  return tab;
}

/** Kop vergelijkbaar maken: kleine letters, geen accenten, geen spaties. */
function norm_(tekst) {
  return String(tekst == null ? '' : tekst)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '');
}

function letter_(kolom) {
  let s = '';
  while (kolom > 0) {
    const r = (kolom - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    kolom = Math.floor((kolom - 1) / 26);
  }
  return s;
}

/** Waarde zoals ze in de sheet getoond wordt, zonder foutcodes als #N/A. */
function schoon_(tekst) {
  const s = String(tekst == null ? '' : tekst).trim();
  return s.charAt(0) === '#' ? '' : s;
}

/**
 * Zoekt alle kolommen van VELDEN in de koprij.
 * Geeft { kol: {id: kolomnummer}, koppen: [...], fouten: [...] }.
 */
function kolommen_(tab) {
  const breedte = tab.getLastColumn();
  const koppen = tab.getRange(INST.KOPRIJ, 1, 1, breedte).getDisplayValues()[0];
  const genormd = koppen.map(norm_);
  const kol = {};
  const fouten = [];
  VELDEN.forEach(function (veld) {
    const treffers = [];
    genormd.forEach(function (k, i) { if (veld.kop.test(k)) treffers.push(i + 1); });
    const nde = veld.nde || 1;
    const verwacht = VELDEN.filter(function (v) { return String(v.kop) === String(veld.kop); }).length;
    if (treffers.length < nde) {
      fouten.push(veld.nieuw
        ? 'Kolom "' + veld.nieuw + '" ontbreekt. Voer installeer() uit.'
        : 'Kop niet gevonden in rij ' + INST.KOPRIJ + ' voor "' + veld.id + '" (' + veld.kop + ').');
      return;
    }
    if (treffers.length > verwacht) {
      fouten.push('Kop komt ' + treffers.length + ' keer voor in plaats van ' + verwacht + ': "' + veld.id + '" (' + veld.kop + ').');
      return;
    }
    kol[veld.id] = treffers[nde - 1];
  });
  return { kol: kol, koppen: koppen, fouten: fouten };
}

function kolommenOfFout_(tab) {
  const k = kolommen_(tab);
  if (k.fouten.length) {
    const err = new Error('De kolomindeling van de sheet klopt niet: ' + k.fouten.join(' | '));
    err.code = 'INDELING';
    throw err;
  }
  return k;
}

/** Eerste rij na de laatste rij waarin Tijdstempel of code ingevuld is. */
function vrijeRij_(tab, kol) {
  const max = tab.getMaxRows();
  const n = max - INST.EERSTE_RIJ + 1;
  let laatste = INST.EERSTE_RIJ - 1;
  if (n > 0) {
    const a = tab.getRange(INST.EERSTE_RIJ, kol.tijdstempel, n, 1).getValues();
    const c = tab.getRange(INST.EERSTE_RIJ, kol.code, n, 1).getValues();
    for (let r = n - 1; r >= 0; r--) {
      if (a[r][0] !== '' || c[r][0] !== '') { laatste = INST.EERSTE_RIJ + r; break; }
    }
  }
  return laatste + 1;
}

function nvtFormule_(kol, veld, rij) {
  return '=IF(' + letter_(kol[veld.nvtAls]) + rij + '="nee";"NVT";)';
}

/* ------------------------------------------------------------------ */
/* snapshot                                                            */
/* ------------------------------------------------------------------ */

function snapshot_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tab = qcTab_();
  const k = kolommen_(tab);
  const waarschuwingen = [];
  k.fouten.forEach(function (f) { waarschuwingen.push(f); });

  const orders = leesBron_(ss, INST.TAB_IMPORT_ORDERS, {
    anker: ['prod.code', 'status'],
    kolommen: {
      code: 'prod.code', status: 'status', product: 'klant+product', lijn: 'lijn',
      inhoud: 'inhoudzk', eenheid: 'g/ge/stuks/ml', grondstof: 'grondstof',
      lotGrd: 'lotgrd', lotZk: 'lotzk', allergenen: 'allergenen'
    },
    verplicht: ['code', 'status', 'product']
  }, waarschuwingen);

  const pallets = leesBron_(ss, INST.TAB_IMPORT_PALLETS, {
    anker: ['palletnummer', 'toestand'],
    kolommen: {
      code: 'palletnummer', toestand: 'toestand', artikel: 'asnartikelcode',
      lot: 'asnlotn°', check1: 'check1', allergenen: 'allergenen'
    },
    verplicht: ['code', 'toestand', 'artikel']
  }, waarschuwingen);

  const ordersUit = orders.rijen.filter(function (r) {
    return r.code && r.product && INST.ORDER_UIT.indexOf(r.status.toLowerCase()) === -1;
  }).map(function (r) {
    return {
      code: r.code, status: r.status, lijn: r.lijn || '', product: r.product,
      lotZk: r.lotZk || '', inhoud: r.inhoud || '', eenheid: r.eenheid || '',
      grondstof: r.grondstof || '', lotGrd: r.lotGrd || '', allergenen: r.allergenen || ''
    };
  });

  // Een pallet krijgt in de app dezelfde vorm als een order. De QC-sheet zelf
  // toont voor een pallet: product = artikelcode, lot = asnlotn°, grondstof =
  // Check1, LOT GRD = asnlotn°.
  const palletsUit = pallets.rijen.filter(function (r) {
    return r.code && r.artikel && r.toestand && INST.PALLET_UIT.indexOf(r.toestand.toLowerCase()) === -1;
  }).map(function (r) {
    return {
      code: r.code, toestand: r.toestand, product: r.artikel, lotZk: r.lot || '',
      grondstof: r.check1 || '', lotGrd: r.lot || '', allergenen: r.allergenen || ''
    };
  });

  return {
    ok: true,
    om: new Date().toISOString(),
    scriptVersie: INST.VERSIE,
    orders: ordersUit,
    pallets: palletsUit,
    velden: k.fouten.length ? {} : leesVelden_(tab, k),
    bron: { orders: orders.bron, pallets: pallets.bron },
    waarschuwingen: waarschuwingen
  };
}

/**
 * Leest een bronsheet. Eerst rechtstreeks (via de IMPORTRANGE-formule van het
 * importtabblad), en als dat niet lukt uit het importtabblad zelf.
 */
function leesBron_(ss, importNaam, def, waarschuwingen) {
  const importTab = ss.getSheetByName(importNaam);
  let bronTab = null;
  let bron = 'rechtstreeks';
  try {
    const verwijzing = importTab ? importVerwijzing_(importTab) : null;
    if (verwijzing) bronTab = SpreadsheetApp.openById(verwijzing.id).getSheetByName(verwijzing.tab);
  } catch (err) {
    bronTab = null;
  }
  if (!bronTab) {
    if (!importTab) throw new Error('Tabblad niet gevonden: ' + importNaam);
    bronTab = importTab;
    bron = 'importtabblad';
    waarschuwingen.push('"' + importNaam + '": de bronsheet kon niet rechtstreeks gelezen worden; het importtabblad is gebruikt en kan verouderd zijn.');
  }
  const rijen = leesTabel_(bronTab, def, waarschuwingen, importNaam);
  return { rijen: rijen, bron: bron };
}

/** Haalt spreadsheet-ID en tabbladnaam uit =IMPORTRANGE("...";"Tab!A:Z"). */
function importVerwijzing_(importTab) {
  const breedte = Math.min(3, importTab.getMaxColumns());
  const formules = importTab.getRange(1, 1, 1, breedte).getFormulas()[0];
  for (let i = 0; i < formules.length; i++) {
    const m = /IMPORTRANGE\(\s*"([^"]+)"\s*[;,]\s*"([^"]+)"/i.exec(formules[i] || '');
    if (!m) continue;
    const id = (m[1].match(/[-\w]{25,}/) || [])[0];
    const tab = m[2].split('!')[0].replace(/^'|'$/g, '');
    if (id && tab) return { id: id, tab: tab };
  }
  return null;
}

/** Zoekt de koprij (binnen de eerste 5 rijen) en leest alleen de nodige kolommen. */
function leesTabel_(tab, def, waarschuwingen, naam) {
  const laatsteRij = tab.getLastRow();
  const breedte = tab.getLastColumn();
  // Een leeg blad is nooit juist: liever een fout dan een lege lijst, zodat de
  // app haar vorige gegevens houdt.
  if (laatsteRij < 1 || breedte < 1) throw new Error('"' + naam + '": het blad is leeg.');
  const kopRijen = tab.getRange(1, 1, Math.min(5, laatsteRij), breedte).getDisplayValues();
  let kopRij = -1;
  let genormd = null;
  for (let r = 0; r < kopRijen.length; r++) {
    const g = kopRijen[r].map(norm_);
    if (def.anker.every(function (a) { return g.indexOf(a) !== -1; })) { kopRij = r + 1; genormd = g; break; }
  }
  if (kopRij === -1) throw new Error('"' + naam + '": koprij niet gevonden (gezocht: ' + def.anker.join(', ') + ').');

  const eerste = kopRij + 1;
  const aantal = laatsteRij - kopRij;
  if (aantal < 1) return [];
  const data = {};
  Object.keys(def.kolommen).forEach(function (sleutel) {
    const c = genormd.indexOf(def.kolommen[sleutel]);
    if (c === -1) {
      if (def.verplicht.indexOf(sleutel) !== -1) throw new Error('"' + naam + '": kolom "' + def.kolommen[sleutel] + '" niet gevonden.');
      waarschuwingen.push('"' + naam + '": kolom "' + def.kolommen[sleutel] + '" niet gevonden; dat veld blijft leeg.');
      return;
    }
    data[sleutel] = tab.getRange(eerste, c + 1, aantal, 1).getDisplayValues();
  });

  const rijen = [];
  for (let r = 0; r < aantal; r++) {
    const rij = {};
    Object.keys(data).forEach(function (sleutel) { rij[sleutel] = schoon_(data[sleutel][r][0]); });
    rijen.push(rij);
  }
  return rijen;
}

/**
 * Leest per invoerkolom de gegevensvalidatie uit de eerstvolgende lege rij.
 * De app toont exact deze keuzes.
 */
function leesVelden_(tab, k) {
  const rij = Math.min(vrijeRij_(tab, k.kol), tab.getMaxRows());
  const breedte = tab.getLastColumn();
  const regels = tab.getRange(rij, 1, 1, breedte).getDataValidations()[0];
  // Heeft de lege rij geen validatie (voorbereide rijen op), dan telt de rij erboven.
  const erboven = rij > INST.EERSTE_RIJ ? tab.getRange(rij - 1, 1, 1, breedte).getDataValidations()[0] : [];
  const T = SpreadsheetApp.DataValidationCriteria;
  const uit = {};
  VELDEN.forEach(function (veld) {
    if (!veld.soort) return;
    const c = k.kol[veld.id];
    const regel = regels[c - 1] || erboven[c - 1];
    let soort = 'vrij';
    let keuzes = [];
    if (regel) {
      const type = regel.getCriteriaType();
      const args = regel.getCriteriaValues();
      if (type === T.CHECKBOX) {
        soort = 'vakje';
      } else if (type === T.VALUE_IN_LIST) {
        soort = 'lijst';
        keuzes = args[0].map(function (x) { return String(x).trim(); });
      } else if (type === T.VALUE_IN_RANGE) {
        soort = 'lijst';
        args[0].getDisplayValues().forEach(function (r) {
          r.forEach(function (x) { x = String(x).trim(); if (x && keuzes.indexOf(x) === -1) keuzes.push(x); });
        });
      }
    }
    uit[veld.id] = { kolom: letter_(c), kop: String(k.koppen[c - 1]).trim(), soort: soort, keuzes: keuzes.filter(function (x) { return x !== ''; }) };
  });
  return uit;
}

/* ------------------------------------------------------------------ */
/* controle                                                            */
/* ------------------------------------------------------------------ */

function controle_(v) {
  const fout = function (code, tekst) { return { ok: false, code: code, fout: tekst }; };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v.appId || ''))) return fout('VERZOEK', 'Ongeldig app-ID.');
  if (v.deel !== 'boven' && v.deel !== 'beneden') return fout('VERZOEK', 'Ongeldig deel.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.datum || ''))) return fout('VERZOEK', 'Ongeldige datum.');
  const code = String(v.code == null ? '' : v.code).trim();
  if (!code || code.length > 40) return fout('VERZOEK', 'Ongeldige code.');
  const waarden = v.waarden || {};
  const vervallen = v.vervallen || [];

  const slot = LockService.getScriptLock();
  try {
    slot.waitLock(INST.WACHT_OP_SLOT_MS);
  } catch (err) {
    return { ok: false, code: 'BEZET', tijdelijk: true, fout: 'De sheet is bezet, probeer opnieuw.' };
  }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tab = qcTab_();
    let k;
    try { k = kolommenOfFout_(tab); } catch (err) { return fout('INDELING', err.message); }
    const kol = k.kol;
    const tz = ss.getSpreadsheetTimeZone();

    // 1. Bestaat het app-ID al?
    let rij = zoekAppId_(tab, kol, v.appId);
    let nieuw = false;
    if (!rij) {
      // 2. Nieuwe rij. Het app-ID gaat er eerst in: valt het script hierna
      //    uit, dan vindt de herhaling dezelfde rij terug en komt er geen dubbel.
      rij = vrijeRij_(tab, kol);
      if (rij > tab.getMaxRows()) nieuweRij_(tab, kol);
      nieuw = true;
      zetTekst_(tab.getRange(rij, kol.appId), v.appId);
    }
    const codeCel = tab.getRange(rij, kol.code);
    const staat = String(codeCel.getValue()).trim();
    if (staat === '') {
      tab.getRange(rij, kol.tijdstempel).setValue(Utilities.parseDate(v.datum + ' 00:00', tz, 'yyyy-MM-dd HH:mm'));
      // Een gewone productiecode of palletnummer wordt een getal, zodat de
      // opzoekformules werken. Al de rest (voorloopnul, streepje, letters) blijft tekst.
      if (/^\d{1,15}$/.test(code) && String(Number(code)) === code) codeCel.setValue(Number(code));
      else zetTekst_(codeCel, code);
    } else if (staat !== code) {
      return fout('CODE_VERSCHILT', 'Rij ' + rij + ' heeft code "' + staat + '" in plaats van "' + code + '".');
    }

    // Een oud verzoek dat te laat aankomt (na een correctie) mag de nieuwere
    // versie niet overschrijven.
    const om = new Date(v.afgeslotenOm);
    const omCel = tab.getRange(rij, v.deel === 'boven' ? kol.bovenOm : kol.benedenOm);
    const stond = omCel.getValue();
    if (!isNaN(om.getTime()) && Object.prototype.toString.call(stond) === '[object Date]' && stond.getTime() > om.getTime()) {
      return { ok: true, appId: v.appId, deel: v.deel, rij: rij, nieuw: false, verouderd: true };
    }

    // 3. Alleen de kolommen van het ontvangen deel.
    const formules = tab.getRange(rij, 1, 1, tab.getLastColumn()).getFormulas()[0];
    VELDEN.forEach(function (veld) {
      if (veld.deel !== v.deel || !veld.soort) return;
      const cel = tab.getRange(rij, kol[veld.id]);
      if (veld.nvtAls && vervallen.indexOf(veld.id) !== -1) {
        // 4. Vervallen punt: de NVT-formule blijft staan of komt terug.
        if (!formules[kol[veld.id] - 1]) cel.setFormula(nvtFormule_(kol, veld, rij));
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(waarden, veld.id)) return;
      zet_(cel, veld, waarden[veld.id]);
    });

    // Wat de controleur zag.
    VELDEN.forEach(function (veld) {
      if (veld.deel !== v.deel || !veld.gezien) return;
      const cel = tab.getRange(rij, kol[veld.id]);
      const tekst = v.gezien ? v.gezien[veld.gezien] : '';
      if (tekst) zetTekst_(cel, tekst); else cel.clearContent();
    });

    // Tijdstippen.
    const tijdFormaat = 'dd-MM-yyyy HH:mm';
    if (!isNaN(om.getTime())) omCel.setNumberFormat(tijdFormaat).setValue(om);
    tab.getRange(rij, kol.ontvangenOm).setNumberFormat(tijdFormaat).setValue(new Date());

    SpreadsheetApp.flush();
    // 5.
    return { ok: true, appId: v.appId, deel: v.deel, rij: rij, nieuw: nieuw };
  } finally {
    // Eerst alles wegschrijven, dan pas het slot vrijgeven.
    try { SpreadsheetApp.flush(); } catch (err) { /* de fout zelf is al onderweg */ }
    slot.releaseLock();
  }
}

function zoekAppId_(tab, kol, appId) {
  const laatste = tab.getLastRow();
  const n = laatste - INST.EERSTE_RIJ + 1;
  if (n < 1) return 0;
  const ids = tab.getRange(INST.EERSTE_RIJ, kol.appId, n, 1).getValues();
  for (let r = 0; r < n; r++) if (ids[r][0] === appId) return INST.EERSTE_RIJ + r;
  return 0;
}

/** Voegt onderaan een rij toe met de formules, validatie en opmaak van de rij erboven. */
function nieuweRij_(tab, kol) {
  const boven = tab.getMaxRows();
  const breedte = tab.getMaxColumns();
  tab.insertRowsAfter(boven, 1);
  const doel = boven + 1;
  tab.getRange(boven, 1, 1, breedte).copyTo(tab.getRange(doel, 1, 1, breedte));
  // Alles wat geen formule is, is invoer van de rij erboven (ook foto's en oude
  // kolommen): wissen. Formules, validatie en opmaak blijven staan.
  const formules = tab.getRange(doel, 1, 1, breedte).getFormulas()[0];
  for (let c = 1; c <= breedte; c++) if (!formules[c - 1]) tab.getRange(doel, c).clearContent();
  VELDEN.forEach(function (veld) {
    const cel = tab.getRange(doel, kol[veld.id]);
    if (veld.nvtAls) cel.setFormula(nvtFormule_(kol, veld, doel));
    else if (veld.soort === 'vakje') cel.setValue(false);
  });
}

function zet_(cel, veld, waarde) {
  if (veld.soort === 'vakje') { cel.setValue(waarde === true); return; }
  if (waarde === null || waarde === undefined || waarde === '') { cel.clearContent(); return; }
  if (veld.soort === 'tekst') { zetTekst_(cel, waarde); return; }
  if (veld.soort === 'getal') {
    const g = Number(String(waarde).replace(',', '.'));
    if (isNaN(g)) throw new Error('Geen getal voor "' + veld.id + '": ' + waarde);
    cel.setValue(g);
    return;
  }
  // lijst: een keuze die een getal is, wordt als getal geschreven (zoals getypt).
  const s = String(waarde);
  cel.setValue(String(Number(s)) === s ? Number(s) : s);
}

/** Schrijft vrije tekst als tekst: geen formule, geen datum, geen getal. */
function zetTekst_(cel, tekst) {
  let s = String(tekst);
  if (/^[=+\-@']/.test(s)) s = "'" + s;
  cel.setNumberFormat('@').setValue(s);
}

/* ------------------------------------------------------------------ */
/* Uit te voeren vanuit de editor                                      */
/* ------------------------------------------------------------------ */

/**
 * Eenmalig uitvoeren. Voegt de kolommen van de app toe (rechts van de laatste
 * kolom) en maakt een sleutel aan als er nog geen is. Veilig om opnieuw uit te
 * voeren: bestaande kolommen en een bestaande sleutel blijven.
 */
function installeer() {
  const tab = qcTab_();
  const k = kolommen_(tab);
  const ontbrekend = VELDEN.filter(function (v) { return v.nieuw && !k.kol[v.id]; });
  if (ontbrekend.length) {
    const max = tab.getMaxColumns();
    tab.insertColumnsAfter(max, ontbrekend.length);
    tab.showColumns(max + 1, ontbrekend.length);
    const kopCellen = tab.getRange(INST.KOPRIJ, max + 1, 1, ontbrekend.length);
    kopCellen.clearDataValidations();
    kopCellen.setValues([ontbrekend.map(function (v) { return v.nieuw; })]);
    tab.getRange(1, max + 1).setValue('QC-app');
    const rijen = tab.getMaxRows() - INST.KOPRIJ;
    if (rijen > 0) {
      const onder = tab.getRange(INST.EERSTE_RIJ, max + 1, rijen, ontbrekend.length);
      onder.clearDataValidations();
      onder.clearContent();
    }
    Logger.log('Toegevoegd vanaf kolom ' + letter_(max + 1) + ': ' + ontbrekend.map(function (v) { return v.nieuw; }).join(', '));
  } else {
    Logger.log('Alle kolommen van de app bestaan al.');
  }

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SLEUTEL')) {
    props.setProperty('SLEUTEL', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
    Logger.log('Nieuwe sleutel aangemaakt.');
  }
  Logger.log('SLEUTEL (ingeven op de tablet, niet delen): ' + props.getProperty('SLEUTEL'));
  nakijken();
}

/** Schrijft niets. Toont welke kolommen gevonden zijn en wat de snapshot oplevert. */
function nakijken() {
  const tab = qcTab_();
  const k = kolommen_(tab);
  Logger.log('Tabblad: ' + tab.getName());
  VELDEN.forEach(function (v) {
    const c = k.kol[v.id];
    Logger.log((c ? letter_(c) : '??') + '  ' + v.id + (c ? '  <- "' + String(k.koppen[c - 1]).replace(/\s+/g, ' ').trim().slice(0, 50) + '"' : ''));
  });
  if (k.fouten.length) { Logger.log('FOUTEN: ' + k.fouten.join(' | ')); return; }
  Logger.log('Eerstvolgende vrije rij: ' + vrijeRij_(tab, k.kol));
  let s;
  try {
    s = snapshot_();
  } catch (err) {
    Logger.log('FOUT bij het ophalen van orders en pallets: ' + err.message);
    return;
  }
  Logger.log('Orders: ' + s.orders.length + ' (' + s.bron.orders + '), pallets: ' + s.pallets.length + ' (' + s.bron.pallets + ')');
  Object.keys(s.velden).forEach(function (id) {
    const v = s.velden[id];
    Logger.log(v.kolom + '  ' + id + ': ' + v.soort + (v.keuzes.length ? ' [' + v.keuzes.join(' / ') + ']' : ''));
  });
  if (s.waarschuwingen.length) Logger.log('WAARSCHUWINGEN: ' + s.waarschuwingen.join(' | '));
}

/** Maakt een nieuwe sleutel. De oude werkt daarna niet meer. */
function nieuweSleutel() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SLEUTEL', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  Logger.log('Nieuwe SLEUTEL: ' + props.getProperty('SLEUTEL'));
}
