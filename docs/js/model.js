// De controlepunten, hun groepen en de regels (automatische NVT, open punten).
// Kolomletters en keuzelijsten staan hier niet: die komen uit de snapshot, zodat
// de sheet de enige plek blijft waar lijsten onderhouden worden.

export const DELEN = ['boven', 'beneden'];
export const DEELNAAM = { boven: 'Boven', beneden: 'Beneden' };

// soort: 'vakje' (Ja/Nee), 'keuze' (keuzelijst van de sheet), 'getal', 'tekst'
// nvtAls: vervalt automatisch als dat veld op NEE staat
// leegKeuze: uitdrukkelijke keuze die de cel leeg laat
// reserve: keuzes als de kolom in de sheet geen keuzelijst heeft
export const VELDEN = {
  grdCorrect: { deel: 'boven', soort: 'vakje', label: 'GRD correct?' },
  allergeenEtiket: { deel: 'boven', soort: 'vakje', label: 'Allergenetiket aanwezig en correct?' },
  trechter: { deel: 'boven', soort: 'keuze', label: 'Trechter + mes?', leegKeuze: 'Geen trechter of mes' },
  ordeNetheid: { deel: 'boven', soort: 'keuze', label: 'Gesloten circuits - Orde en netheid - Spillage' },
  opmBoven: { deel: 'boven', soort: 'tekst', label: 'Opmerkingen boven' },

  lotZkCorrect: { deel: 'beneden', soort: 'vakje', label: 'LOT ZK correct?' },
  allergenenCorrect: { deel: 'beneden', soort: 'vakje', label: 'Allergenen correct?' },
  operator1: { deel: 'beneden', soort: 'keuze', label: 'Operator', achtervoegsel: ' (1)' },
  operator2: { deel: 'beneden', soort: 'keuze', label: 'Operator', achtervoegsel: ' (2)', leegKeuze: 'Geen tweede operator' },
  checkweger: { deel: 'beneden', soort: 'keuze', label: 'Checkweger?' },
  cwGewicht: { deel: 'beneden', soort: 'keuze', label: 'Gewicht checkweger = weegschaal?', nvtAls: 'checkweger' },
  cwPlus: { deel: 'beneden', soort: 'keuze', label: 'Controle +1 OK?', nvtAls: 'checkweger' },
  cwMin: { deel: 'beneden', soort: 'keuze', label: 'Controle -1 OK?', nvtAls: 'checkweger' },
  metaaldetector: { deel: 'beneden', soort: 'keuze', label: 'Metaaldetector?' },
  mdUitworp: { deel: 'beneden', soort: 'keuze', label: 'Uitworp testplaatjes?', nvtAls: 'metaaldetector' },
  monoDuo: { deel: 'beneden', soort: 'keuze', label: 'Mono (1) of Duo (2)?', reserve: ['1', '2'] },
  snelheid: { deel: 'beneden', soort: 'getal', label: 'Snelheid (slagen/min)' },
  cProduct: { deel: 'beneden', soort: 'keuze', label: 'Product' },
  cHoudbaarheid: { deel: 'beneden', soort: 'keuze', label: 'Houdbaarheid' },
  cGewicht: { deel: 'beneden', soort: 'keuze', label: 'Gewicht' },
  cZk: { deel: 'beneden', soort: 'keuze', label: 'ZK' },
  cDi: { deel: 'beneden', soort: 'keuze', label: 'DI' },
  cDs: { deel: 'beneden', soort: 'keuze', label: 'DS/pallet' },
  cEtiket: { deel: 'beneden', soort: 'keuze', label: 'Etiket' },
  cDocumenten: { deel: 'beneden', soort: 'keuze', label: 'Documenten' },
  cAllergenen: { deel: 'beneden', soort: 'keuze', label: 'Allergenenbeleid & vreemde voorwerpen' },
  opmBeneden: { deel: 'beneden', soort: 'tekst', label: 'Opmerkingen beneden' }
};

// Per scherm één groep van samenhangende punten.
// toon: opzoekwaarden die bij de groep horen.
export const GROEPEN = {
  boven: [
    { titel: 'Grondstof en afvulling', toon: ['grondstof', 'lotGrd', 'allergenen'], velden: ['grdCorrect', 'allergeenEtiket', 'trechter', 'ordeNetheid', 'opmBoven'] }
  ],
  beneden: [
    { titel: 'Lot, allergenen en operator', toon: ['product', 'lotZk', 'allergenen'], velden: ['lotZkCorrect', 'allergenenCorrect', 'operator1', 'operator2'] },
    { titel: 'Checkweger', toon: [], velden: ['checkweger', 'cwGewicht', 'cwPlus', 'cwMin'] },
    { titel: 'Metaaldetector en lijn', toon: [], velden: ['metaaldetector', 'mdUitworp', 'monoDuo', 'snelheid'] },
    { titel: 'Product, houdbaarheid, gewicht, ZK en DI', toon: ['product', 'lotZk'], velden: ['cProduct', 'cHoudbaarheid', 'cGewicht', 'cZk', 'cDi'] },
    { titel: 'DS/pallet, etiket, documenten en allergenenbeleid', toon: [], velden: ['cDs', 'cEtiket', 'cDocumenten', 'cAllergenen', 'opmBeneden'] }
  ]
};

export const OPMERKING = { boven: 'opmBoven', beneden: 'opmBeneden' };
export const OPZOEKNAAM = { product: 'Product', lotZk: 'LOT ZK', grondstof: 'Grondstof', lotGrd: 'LOT GRD', allergenen: 'Allergenen' };
export const OPZOEKVELDEN = ['product', 'lotZk', 'grondstof', 'lotGrd', 'allergenen'];
// Welke opzoekwaarden bij welk deel horen (kolommen "Gezien: ...").
export const GEZIEN = { boven: ['grondstof', 'lotGrd', 'allergenen'], beneden: ['product', 'lotZk', 'allergenen'] };

export function veldenVan(deel) {
  return GROEPEN[deel].flatMap((g) => g.velden);
}

/** Kop van de kolom in de sheet, anders de naam uit deze code. */
export function label(id, snapshot) {
  const v = VELDEN[id];
  const uitSheet = snapshot && snapshot.velden && snapshot.velden[id] && snapshot.velden[id].kop;
  const basis = uitSheet ? uitSheet.replace(/\s+/g, ' ').trim() : v.label;
  return basis + (v.achtervoegsel || '');
}

/**
 * De keuzes van een punt: [{ waarde, tekst }].
 * Geeft null als de sheet voor dit punt geen keuzelijst heeft; de app verzint
 * dan geen eigen antwoorden.
 */
export function keuzes(id, snapshot) {
  const v = VELDEN[id];
  if (v.soort === 'vakje') return [{ waarde: true, tekst: 'Ja' }, { waarde: false, tekst: 'Nee' }];
  if (v.soort !== 'keuze') return [];
  const uitSheet = snapshot && snapshot.velden && snapshot.velden[id] ? snapshot.velden[id].keuzes : null;
  const lijst = uitSheet && uitSheet.length ? uitSheet : v.reserve;
  if (!lijst || !lijst.length) return null;
  const uit = lijst.map((k) => ({ waarde: String(k), tekst: String(k) }));
  if (v.leegKeuze) uit.push({ waarde: '', tekst: v.leegKeuze, leeg: true });
  return uit;
}

export const isNee = (waarde) => String(waarde == null ? '' : waarde).trim().toLowerCase() === 'nee';
const isAfwijking = (waarde) => ['nok', 'stop'].includes(String(waarde == null ? '' : waarde).trim().toLowerCase());

/** Vervalt dit punt door een ander antwoord (automatische NVT)? */
export function isVervallen(id, antwoorden) {
  const v = VELDEN[id];
  return !!v.nvtAls && isNee(antwoorden[v.nvtAls]);
}

export function isBeantwoord(id, antwoorden) {
  const v = VELDEN[id];
  if (isVervallen(id, antwoorden)) return true;
  if (v.soort === 'tekst') return true;
  const a = antwoorden[id];
  if (v.soort === 'getal') return a !== undefined && a !== '' && !isNaN(Number(String(a).replace(',', '.')));
  return a !== undefined;
}

/** Een NOK of STOP vraagt een opmerking. */
export function opmerkingNodig(deel, antwoorden) {
  const afwijking = veldenVan(deel).some((id) => !isVervallen(id, antwoorden) && isAfwijking(antwoorden[id]));
  return afwijking && !String(antwoorden[OPMERKING[deel]] || '').trim();
}

/** Open punten van een deel, of van één groep ervan. */
export function openPunten(deel, antwoorden, groep) {
  const ids = groep === undefined ? veldenVan(deel) : GROEPEN[deel][groep].velden;
  const open = ids.filter((id) => !isBeantwoord(id, antwoorden));
  const opm = OPMERKING[deel];
  if (ids.includes(opm) && opmerkingNodig(deel, antwoorden)) open.push(opm);
  return open;
}

/** Zet een antwoord en wist antwoorden die daardoor vervallen. */
export function zetAntwoord(antwoorden, id, waarde) {
  if (waarde === undefined) delete antwoorden[id]; else antwoorden[id] = waarde;
  Object.keys(VELDEN).forEach((ander) => {
    if (VELDEN[ander].nvtAls === id && isNee(waarde)) delete antwoorden[ander];
  });
}

export function vandaag(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function nieuwId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const leegDeel = () => ({ status: 'open', antwoorden: {}, versie: 0, afgeslotenOm: null, gezien: null, verzondenOm: null, rij: null });

/** item: een order of pallet uit de snapshot, of null bij een ingetypte code. */
export function nieuweControle(code, item, bron) {
  const opzoek = {};
  OPZOEKVELDEN.forEach((k) => { opzoek[k] = item ? item[k] || '' : ''; });
  return {
    appId: nieuwId(),
    datum: vandaag(),
    aangemaaktOm: Date.now(),
    code: String(code).trim(),
    bron, // 'order', 'pallet' of 'vrij'
    lijn: item ? item.lijn || '' : '',
    opzoek,
    wijziging: null,
    delen: { boven: leegDeel(), beneden: leegDeel() }
  };
}

/** Het verzoek voor het script: alleen de kolommen van dit deel. */
export function bouwVerzoek(controle, deel) {
  const d = controle.delen[deel];
  const waarden = {};
  const vervallen = [];
  veldenVan(deel).forEach((id) => {
    if (isVervallen(id, d.antwoorden)) { vervallen.push(id); return; }
    const a = d.antwoorden[id];
    waarden[id] = a === undefined ? '' : a;
  });
  return {
    appId: controle.appId,
    deel,
    datum: controle.datum,
    code: controle.code,
    waarden,
    vervallen,
    gezien: d.gezien,
    afgeslotenOm: d.afgeslotenOm
  };
}

/** Zoekt een code in de snapshot. */
export function zoekCode(snapshot, code) {
  const c = String(code).trim();
  if (!snapshot || !c) return null;
  const order = (snapshot.orders || []).find((o) => String(o.code) === c);
  if (order) return { item: order, bron: 'order' };
  const pallet = (snapshot.pallets || []).find((p) => String(p.code) === c);
  if (pallet) return { item: pallet, bron: 'pallet' };
  return null;
}
