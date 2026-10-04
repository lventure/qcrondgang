// Nagebootste Apps Script-omgeving, net genoeg om apps-script/Code.gs te laten
// draaien buiten Google. Dit is GEEN volledige nabootsing van Sheets: het bewijst
// de logica van het script, niet het gedrag van Google zelf.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CRIT = { CHECKBOX: 'CHECKBOX', VALUE_IN_LIST: 'VALUE_IN_LIST', VALUE_IN_RANGE: 'VALUE_IN_RANGE' };

const regel = (type, args) => ({ getCriteriaType: () => type, getCriteriaValues: () => args });
const lijstRegel = (waarden) => regel(CRIT.VALUE_IN_LIST, [waarden.slice(), true]);
const vakjeRegel = () => regel(CRIT.CHECKBOX, []);

function letterNaarKolom(l) {
  let n = 0;
  for (const ch of l.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

class NepTab {
  constructor(naam, rijen, kolommen) {
    this.naam = naam;
    this.maxRijen = rijen;
    this.maxKolommen = kolommen;
    this.cellen = new Map(); // "r,c" -> { v, f, dv, fmt }
  }
  cel(r, c, maak) {
    const k = r + ',' + c;
    let x = this.cellen.get(k);
    if (!x && maak) { x = { v: '', f: '', dv: null, fmt: '' }; this.cellen.set(k, x); }
    return x;
  }
  getName() { return this.naam; }
  getMaxRows() { return this.maxRijen; }
  getMaxColumns() { return this.maxKolommen; }
  getLastRow() {
    let m = 0;
    for (const [k, x] of this.cellen) if (x.v !== '' || x.f) m = Math.max(m, Number(k.split(',')[0]));
    return m;
  }
  getLastColumn() {
    let m = 0;
    for (const [k, x] of this.cellen) if (x.v !== '' || x.f) m = Math.max(m, Number(k.split(',')[1]));
    return m;
  }
  getRange(r, c, nr = 1, nc = 1) {
    if (r < 1 || c < 1 || r + nr - 1 > this.maxRijen || c + nc - 1 > this.maxKolommen) {
      throw new Error(`Bereik buiten het blad: rij ${r}, kolom ${c}, ${nr}x${nc} (blad is ${this.maxRijen}x${this.maxKolommen})`);
    }
    return new NepBereik(this, r, c, nr, nc);
  }
  insertRowsAfter(rij, n) {
    if (rij !== this.maxRijen) throw new Error('Nep: alleen onderaan invoegen is nagebootst');
    this.maxRijen += n;
  }
  insertColumnsAfter(kolom, n) {
    if (kolom !== this.maxKolommen) throw new Error('Nep: alleen rechts invoegen is nagebootst');
    this.maxKolommen += n;
  }
  showColumns() {}
  // Waarde zoals Sheets ze berekent. Alleen de NVT-formule is nagebootst.
  waarde(r, c) {
    const x = this.cel(r, c);
    if (!x) return '';
    if (x.f) {
      const m = /^=IF\(([A-Z]+)(\d+)="nee";"NVT";\)$/i.exec(x.f);
      if (m) {
        const bron = this.waarde(Number(m[2]), letterNaarKolom(m[1]));
        return String(bron).toLowerCase() === 'nee' ? 'NVT' : '';
      }
      return x.v; // andere formules: de vooraf ingevulde "uitkomst"
    }
    return x.v;
  }
  toon(r, c) {
    const v = this.waarde(r, c);
    if (Object.prototype.toString.call(v) === '[object Date]') {
      const p = (n) => String(n).padStart(2, '0');
      const basis = `${p(v.getDate())}-${p(v.getMonth() + 1)}-${v.getFullYear()}`;
      return v.getHours() || v.getMinutes() ? `${basis} ${p(v.getHours())}:${p(v.getMinutes())}` : basis;
    }
    if (v === true) return 'TRUE';
    if (v === false) return 'FALSE';
    return String(v);
  }
}

class NepBereik {
  constructor(tab, r, c, nr, nc) { Object.assign(this, { tab, r, c, nr, nc }); }
  _map(fn) {
    const uit = [];
    for (let i = 0; i < this.nr; i++) {
      const rij = [];
      for (let j = 0; j < this.nc; j++) rij.push(fn(this.r + i, this.c + j));
      uit.push(rij);
    }
    return uit;
  }
  getValues() { return this._map((r, c) => this.tab.waarde(r, c)); }
  getDisplayValues() { return this._map((r, c) => this.tab.toon(r, c)); }
  getFormulas() { return this._map((r, c) => (this.tab.cel(r, c) || {}).f || ''); }
  getDataValidations() { return this._map((r, c) => (this.tab.cel(r, c) || {}).dv || null); }
  getValue() { return this.getValues()[0][0]; }
  getDisplayValue() { return this.getDisplayValues()[0][0]; }
  getFormula() { return this.getFormulas()[0][0]; }
  setNumberFormat(fmt) { this._map((r, c) => { this.tab.cel(r, c, true).fmt = fmt; }); return this; }
  setFormula(f) { this._map((r, c) => { const x = this.tab.cel(r, c, true); x.f = f; x.v = ''; }); return this; }
  clearContent() { this._map((r, c) => { const x = this.tab.cel(r, c); if (x) { x.v = ''; x.f = ''; } }); return this; }
  clearDataValidations() { this._map((r, c) => { const x = this.tab.cel(r, c); if (x) x.dv = null; }); return this; }
  setValue(v) { this._map((r, c) => this._zet(r, c, v)); return this; }
  setValues(m) { this._map((r, c) => this._zet(r, c, m[r - this.r][c - this.c])); return this; }
  _zet(r, c, v) {
    const x = this.tab.cel(r, c, true);
    // Gegevensvalidatie: een keuzelijst weigert een waarde die er niet in staat.
    if (x.dv && x.dv.getCriteriaType() === CRIT.VALUE_IN_LIST && v !== '' && v !== null) {
      const toegelaten = x.dv.getCriteriaValues()[0].map(String);
      if (!toegelaten.includes(String(v))) throw new Error(`De gegevens die je hebt ingevoerd in cel schenden de gegevensvalidatie (${v})`);
    }
    x.f = '';
    if (typeof v === 'string') {
      // Zoals getypt: apostrof = tekst, = is formule, een getal wordt een getal.
      if (v.startsWith("'")) x.v = v.slice(1);
      else if (v.startsWith('=')) { x.f = v; x.v = ''; }
      else if (x.fmt !== '@' && v.trim() !== '' && !isNaN(Number(v))) x.v = Number(v);
      else x.v = v;
    } else {
      x.v = v === null || v === undefined ? '' : v;
    }
  }
  copyTo(doel) {
    this._map((r, c) => {
      const bron = this.tab.cel(r, c);
      const dr = doel.r + (r - this.r);
      const dc = doel.c + (c - this.c);
      if (!bron) { doel.tab.cellen.delete(dr + ',' + dc); return; }
      const f = bron.f ? bron.f.replace(/([A-Z]+)(\d+)/g, (m, l, n) => (Number(n) === r ? l + dr : m)) : '';
      doel.tab.cellen.set(dr + ',' + dc, { v: bron.v, f, dv: bron.dv, fmt: bron.fmt });
    });
  }
}

class NepSpreadsheet {
  constructor(naam) { this.naam = naam; this.tabs = new Map(); }
  getName() { return this.naam; }
  getId() { return this.id || 'NEP-QC-SHEET'; }
  getSpreadsheetTimeZone() { return 'Europe/Brussels'; }
  getSheetByName(n) { return this.tabs.get(n) || null; }
  nieuwTab(naam, rijen, kolommen) { const t = new NepTab(naam, rijen, kolommen); this.tabs.set(naam, t); return t; }
}

/** Laadt Code.gs in een eigen context met de nagebootste Google-diensten. */
/** Nagebootste geavanceerde dienst "Google Sheets API" (alleen Values.get en Values.batchGet). */
function nepSheetsDienst(opId, teller, magLezen) {
  function lees(id, bereik, opties) {
    teller.api += 1;
    const ss = opId[id];
    if (!ss || !magLezen()) throw new Error('API call to sheets.spreadsheets.values.get failed with error: The caller does not have permission');
    const m = /^'((?:[^']|'')+)'!(.+)$/.exec(bereik);
    const tab = ss.getSheetByName(m[1].replace(/''/g, "'"));
    if (!tab) throw new Error('Unable to parse range: ' + bereik);
    const laatsteRij = tab.getLastRow();
    const laatsteKolom = tab.getLastColumn();
    let waarden;
    let r = /^(\d+):(\d+)$/.exec(m[2]);
    if (r) {
      waarden = [];
      for (let rij = Number(r[1]); rij <= Math.min(Number(r[2]), laatsteRij); rij++) {
        const regel = [];
        for (let c = 1; c <= laatsteKolom; c++) regel.push(tab.toon(rij, c));
        while (regel.length && regel[regel.length - 1] === '') regel.pop();
        waarden.push(regel);
      }
      while (waarden.length && !waarden[waarden.length - 1].length) waarden.pop();
    } else {
      r = /^([A-Z]+)(\d+):([A-Z]+)$/.exec(m[2]);
      if (!r || r[1] !== r[3]) throw new Error('Nep: bereik niet nagebootst: ' + bereik);
      const kolom = [];
      for (let rij = Number(r[2]); rij <= laatsteRij; rij++) kolom.push(rij === teller.apiVerberg ? '' : tab.toon(rij, letterNaarKolom(r[1])));
      while (kolom.length && kolom[kolom.length - 1] === '') kolom.pop();
      if (opties.majorDimension !== 'COLUMNS') throw new Error('Nep: alleen COLUMNS nagebootst voor kolombereiken');
      waarden = kolom.length ? [kolom] : undefined;
    }
    if (opties.valueRenderOption !== 'FORMATTED_VALUE') throw new Error('Nep: alleen FORMATTED_VALUE nagebootst');
    const uit = { range: bereik };
    if (waarden && waarden.length) uit.values = waarden;
    return uit;
  }
  return { Spreadsheets: { Values: {
    get: (id, bereik, opties) => lees(id, bereik, opties || {}),
    batchGet: (id, opties) => ({ spreadsheetId: id, valueRanges: opties.ranges.map((b) => lees(id, b, opties)) })
  } } };
}

function laadScript({ actief, opId, eigenschappen = {}, sheetsDienst = false }) {
  const props = { ...eigenschappen };
  const teller = { openById: 0, api: 0, apiToegang: true, apiVerberg: 0 };
  const logboek = [];
  let uuidTeller = 0;
  const slot = { bezet: false };
  const sandbox = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => actief,
      openById: (id) => {
        teller.openById += 1;
        if (!opId[id]) throw new Error('Je hebt geen toegang tot het document ' + id);
        return opId[id];
      },
      flush: () => {},
      DataValidationCriteria: CRIT
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({
      waitLock: () => { if (slot.bezet) throw new Error('Lock timeout'); slot.bezet = true; },
      releaseLock: () => { slot.bezet = false; }
    }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (tekst) => ({ tekst, setMimeType() { return this; } })
    },
    Utilities: {
      getUuid: () => `00000000-0000-4000-8000-${String(++uuidTeller).padStart(12, '0')}`,
      parseDate: (s) => {
        const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s);
        return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
      }
    },
    Logger: { log: (x) => logboek.push(String(x)) }
  };
  if (sheetsDienst) sandbox.Sheets = nepSheetsDienst({ ...opId, [actief.getId()]: actief }, teller, () => teller.apiToegang);
  vm.createContext(sandbox);
  const bron = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  // const/let op het hoogste niveau zijn niet zichtbaar als eigenschap; functies wel.
  vm.runInContext(bron, sandbox, { filename: 'Code.gs' });
  return {
    post: (obj) => JSON.parse(sandbox.doPost({ postData: { contents: typeof obj === 'string' ? obj : JSON.stringify(obj) } }).tekst),
    roep: (naam, ...args) => vm.runInContext(naam, sandbox)(...args),
    props, logboek, slot, teller
  };
}

module.exports = { NepSpreadsheet, NepTab, laadScript, lijstRegel, vakjeRegel, letterNaarKolom, CRIT };
