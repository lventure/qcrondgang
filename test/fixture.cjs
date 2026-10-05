// Nagebootste sheets met dezelfde koppen als de testkopie (gelezen op 2 okt 2026),
// maar met verzonnen orders, pallets en operatoren.
const { NepSpreadsheet, lijstRegel, vakjeRegel, letterNaarKolom } = require('./nep-apps-script.cjs');

const QC_TAB = 'TEST_Auto Verkorte kwaliteitscontrole productie';
const ID_PROD = '1NEPproductielijst0000000000000000000000000AAA';
const ID_POCO = '1NEPpocolist000000000000000000000000000000BBB';

const QC_KOPPEN = {
  A: 'Tijdstempel', B: 'Lijn', C: 'jaar/maand', D: 'Maand (Tijdstempel)', E: 'Aantal OK/NVT', F: 'Aantal NIET OK', G: 'Aantal STOP',
  H: 'Totaal Aantal checks', I: 'Productiecode of Palletnr (Poco)', J: 'Klant + Product', K: 'LOT ZK', L: 'LOT ZK Correct?',
  M: 'Allergenen check', N: 'Allergenen correct?', O: 'Inhoud ZK', P: 'g/ge/stuks/mL', Q: 'Operator', R: 'Operator', S: 'Checkweger?',
  T: 'Gewicht checkweigher = weegschaal?', U: 'Controle + 1 OK? ', V: 'Controle - 1 OK? ', W: 'Metaal- detector?', X: 'Uitworp testplaatjes?',
  Y: 'Mono (1) of Duo (2)?', Z: 'Snelheid (slagen/min)', AA: 'Opmerkingen beneden',
  AB: 'Product: naam - lot ZK, DI en etiket - etiket GR', AC: 'Houdbaarheid: ZK, DI en etiket', AD: 'Gewicht: tarra - gemiddelde - regelmatig',
  AE: 'ZK: folie - inkjet - zijlassen - inkeping', AF: 'DI: type - inkjet - sluiting', AG: 'DS/pallet: Type - Staat - Stapeling - Palletblad',
  AH: 'Etiket: Type - Lees- / scanbaar', AI: 'Documenten: Voorblad - Gewichtsfiche - (folie)lotnummer',
  AJ: 'Allergenenbeleid & vreemde voorwerpen: Line clearance - Vreemde voorwerpen (werk- & poetsmateriaal, folie), lassenkuiser, hygiëne operator',
  AK: 'Foto ZK & Gewichtsfiche', AL: 'Foto etiket (indien achteraan)', AM: 'THT ZK', AN: 'Grondstof', AO: 'LOT GRD', AP: 'GRD correct?', AQ: 'Allergenen',
  AR: 'Allergenetiket aanwezig en correct?', AS: 'Trechter + mes?', AT: 'Gesloten circuits - Orde en netheid - Spillage', AU: 'Opmerkingen boven',
  AV: 'Grondstof & Zakje verschillend lot?', AW: 'Allergenen gelijk?', AX: 'THT GRD'
};

const TAB_WERK = 'Rondgang Werkmaterialen Boven';
const TAB_MAGAZIJN = 'Magazijn en bufferzone';
const WERK_KOPPEN = [
  'Trechter 1 - Vierkant\n\nMes ok?', 'Trechter 2 - Zwaar\n\nMes ok?', 'Trechter 3 - Klein\n\nMes ok?',
  'Inspectie afvulbuizen',
  'Werk- & poetsmateriaal L4\n\nPlatte schroevendraaier\nVloerborstel\nok?', 'Werk- & poetsmateriaal L5\n\n2 Halve maan sleutels\nok?',
  'Takel 1\n\nHamer ok?', 'Takel 2\n\nHamer ok?', 'Mottenval L4'
];
const MAGAZIJN_PUNTEN = [
  { ok: 'E', actief: true, kop: 'Inspectie verzending vracht: Netjes? Palletblad? Hoeken? Afgedekt?' },
  { ok: 'H', actief: true, kop: 'Inspectie materiaal: transpalletten + heftruck proper?' },
  { ok: 'K', actief: false, kop: 'Inspectie afvulbuizen: proper? Intact?' },
  { ok: 'N', actief: true, kop: 'Inspectie ongedierte: Nergens uitwerpselen te zien?' },
  { ok: 'R', actief: true, kop: 'Afvalstraatje (netheid omgeving afvalcontainer)' }
];

/** Een datum op n dagen van vandaag, om middernacht. */
function dag(verschil) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + verschil);
  return d;
}
function iso(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const OPERATOREN = ['AB', 'CD', 'EF', 'GH', 'IJ', 'KL', 'Interim/Flexi'];
const JA_NEE = ['JA', 'NEE'];
const OK3 = ['OK', 'NOK', 'NVT'];
const OK4 = ['OK', 'NOK', 'NVT', 'STOP'];
const TRECHTERS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const FORMULE_KOLOMMEN = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'M', 'O', 'P', 'AM', 'AN', 'AO', 'AQ', 'AX'];

/** Een voorbereide lege rij: formules, selectievakjes en keuzelijsten, zoals in de sheet. */
function bereidRijVoor(tab, r) {
  const zet = (l, x) => Object.assign(tab.cel(r, letterNaarKolom(l), true), x);
  FORMULE_KOLOMMEN.forEach((l) => zet(l, { f: `=FORMULE_${l}(I${r})`, v: '' }));
  ['L', 'N', 'AP', 'AR'].forEach((l) => zet(l, { v: false, dv: vakjeRegel() }));
  ['Q', 'R'].forEach((l) => zet(l, { dv: lijstRegel(OPERATOREN) }));
  ['S', 'W'].forEach((l) => zet(l, { dv: lijstRegel(JA_NEE) }));
  ['T', 'U', 'V'].forEach((l) => zet(l, { f: `=IF(S${r}="nee";"NVT";)`, dv: lijstRegel(OK3) }));
  zet('X', { f: `=if(W${r}="nee";"NVT";)`, dv: lijstRegel(OK3) });
  // Y (Mono/Duo/Sticks) heeft in de echte sheet geen keuzelijst: er staan gewoon getallen (1, 2 of 5).
  ['AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AT'].forEach((l) => zet(l, { dv: lijstRegel(OK4) }));
  zet('AS', { dv: lijstRegel(TRECHTERS) });
}

function vulTabel(tab, kopRij, koppen, rijen) {
  koppen.forEach((k, i) => { tab.cel(kopRij, i + 1, true).v = k; });
  rijen.forEach((rij, r) => rij.forEach((v, c) => { tab.cel(kopRij + 1 + r, c + 1, true).v = v; }));
}

function maakFixture({ legeRijen = 3 } = {}) {
  const qc = new NepSpreadsheet('QC Productie dagelijkse rondgang (nep)');

  // --- hoofdtabblad: 2 ingevulde rijen (3 en 4), daarna voorbereide lege rijen
  const laatste = 4 + legeRijen;
  const tab = qc.nieuwTab(QC_TAB, laatste, 50);
  tab.cel(1, letterNaarKolom('AF'), true).v = 'Controles';
  tab.cel(1, letterNaarKolom('AN'), true).v = 'Boven';
  Object.entries(QC_KOPPEN).forEach(([l, k]) => { tab.cel(2, letterNaarKolom(l), true).v = k; });
  for (let r = 3; r <= laatste; r++) bereidRijVoor(tab, r);
  [[3, 260001], [4, 260002]].forEach(([r, code]) => {
    const zet = (l, v) => { const x = tab.cel(r, letterNaarKolom(l), true); x.v = v; x.f = ''; };
    zet('A', new Date(2026, 9, 1)); zet('I', code);
    zet('L', true); zet('N', true); zet('Q', 'AB'); zet('S', 'NEE'); zet('W', 'NEE'); zet('Y', 1); zet('Z', 50);
    ['AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AT'].forEach((l) => zet(l, 'OK'));
    zet('AP', true); zet('AR', true);
  });

  // --- bron: productielijst (koppen in rij 2, zoals de echte)
  const prod = new NepSpreadsheet('Productielijst (nep)');
  const pTab = prod.nieuwTab('Productielijst', 40, 16);
  ['', '', '', '', '', 'Klant + Product', 'in te vullen', '', 'Inhoud ZK', 'g/ge/stuks/mL', 'LOT ZK', ''].forEach((k, i) => { pTab.cel(1, i + 1, true).v = k; });
  vulTabel(pTab, 2,
    ['Nr', 'Prod.Code', 'Status', 'Klant + Product', 'Lijn', 'Inhoud ZK', 'g/ge/stuks/mL', 'Grondstof', 'LOT GRD', 'Gewenst LOT ZK', 'LOT ZK', 'Allergenen', 'THT GRD', 'Gewenste THT', 'Opmaak THT ZK', 'THT ZK'],
    [
      [1, 260001, 'Klaar', 'Testklant Kruidenmix 20g', 'L4', 20, 'g', 'Kruidenmix A', '111111', '', 'LOT: 2600000001', 'Geen Allergenen', '31/12/2026', 'dd/mm/jjjj', 'THT: dd/mm/jjjj', 'THT: 12/2027'],
      [2, 260002, 'Klaar', 'Testklant Saus 10ml', 'L6', 10, 'mL', 'Saus B', '222222', '', 'LOT: 2600000002', 'mosterd', '30/06/2027', 'dd/mm/jjjj', 'THT: dd/mm/jjjj', 'THT: 06/2028'],
      [3, 260101, 'In productie', 'Voorbeeld Energiegel 40g', 'GELPACK 1', 40, 'g', 'Gelbasis C', '333333', '', 'LOT: 2600000101', 'Geen Allergenen', '15/01/2028', 'dd/mm/jjjj', 'THT: dd/mm/jjjj', 'EXP: 15/07/2028'],
      [4, 260102, 'In productie', 'Voorbeeld Proteïne 100ge', 'L8', 100, 'ge', 'Proteïnepoeder D', '444444', '', 'LOT: 2600000102', 'melk - soja', '30/9/2028', 'dd/mm/jjjj', 'THT: dd/mm/jjjj', 'THT: 30/09/2028'],
      [5, 260103, 'Klaar voor productie', 'Voorbeeld Suikersticks 5g', 'STICKS', 5, 'g', 'Suiker E', '555555', '', 'LOT: 2600000103', 'Geen Allergenen', '03/2028 - 05/2028', 'dd/mm/jjjj', 'THT: dd/mm/jjjj', '1/8/2029'],
      [6, 260104, 'Onvolledig', 'Voorbeeld Notenmix 30g', 'L7', 30, 'g', 'Notenmix F', '666666', '', 'LOT: 2600000104', 'gluten - pinda', '', 'dd/mm/jjjj', 'THT: dd/mm/jjjj', 'THT: 03-2028'],
      [7, 260105, 'KLAAR', 'Voorbeeld Afgewerkt 15g', 'L4', 15, 'g', 'Poeder G', '777777', '', 'LOT: 2600000105', '', '', 'dd/mm/jjjj', 'THT: dd/mm/jjjj', ''],
      [8, 260106, '', '', '#N/A', '', '', '', '', '', '', '', '', 'dd/mm/jjjj', 'THT: dd/mm/jjjj', ''],
      [9, 260107, 'In productie', 'Voorbeeld Zonder lijn 8g', '#N/A', 8, 'g', 'Poeder H', '888888', '', 'LOT: 2600000107', 'selderij', '10/10/2026', 'dd/mm/jjjj', 'THT: dd/mm/jjjj', '']
    ]);

  // --- bron: pocolist (koppen in rij 1)
  const poco = new NepSpreadsheet('Pocolist (nep)');
  const cTab = poco.nieuwTab('pocolist', 40, 9);
  vulTabel(cTab, 1,
    ['', 'Palletnummer', 'asnartikelcode', 'asnlotn°', 'Toestand', 'Check1', 'Allergenen', 'Soort pallet', 'asntht (yymmdd)'],
    [
      [1, 50001, 'ART TACO 30X30G', 439001, 'PALL. BL. VOORHAND.', 'KRUIDENMIX TACO 01', 'Geen Allergenen boven', 'Euro', 271217],
      [2, 50002, 'ART GUA 40X20G', 439002, 'ONVOLL. PALLET', 'KRUIDENMIX GUA 02', 'mosterd', 'Euro', 280101],
      [3, 50003, 'ART FAJ 25X30G', 439003, 'KLAAR', 'KRUIDENMIX FAJ 03', '', 'Euro', 271225],
      [4, 50004, 'ART BUR 25X30G', 439004, 'KLAAR AX', 'KRUIDENMIX BUR 04', '', 'Euro', 271222],
      [5, 50005, 'ART CHI 25X30G', 439005, 'Shipped', 'KRUIDENMIX CHI 05', '', 'Euro', 271224],
      [6, 50006, 'ART NAC 25X30G', 439006, 'Wachten Klaar', 'KRUIDENMIX NAC 06', '', 'Euro', 271228],
      [7, 50007, 'ART SAL 25X30G', 439007, '', 'KRUIDENMIX SAL 07', '', 'Euro', 280102],
      [8, 50008, 'ART ENC 25X30G', 439008, 'VERNIETIGD', 'KRUIDENMIX ENC 08', '', 'Euro', 271201],
      [9, 50009, 'ART QUE 25X30G', 439009, 'niet gebruikt', 'KRUIDENMIX QUE 09', '', 'Euro', 271202],
      [10, 50010, '', '', 'Wachten', '', '', '', '']
    ]);

  // --- importtabbladen in de QC-sheet: alleen de IMPORTRANGE-formule telt
  const imp1 = qc.nieuwTab('ImportProductielijst', 40, 17);
  imp1.cel(1, 2, true).f = `=IMPORTRANGE("${ID_PROD}";"Productielijst!A:Cd")`;
  const imp2 = qc.nieuwTab('poco list', 40, 9);
  imp2.cel(1, 1, true).f = `=IMPORTRANGE("https://docs.google.com/spreadsheets/d/${ID_POCO}/edit";"pocolist!1:6000")`;

  // --- dagtabblad 1: Rondgang Werkmaterialen Boven (één rij per kalenderdag, datums vooraf ingevuld)
  const werk = qc.nieuwTab(TAB_WERK, 2 + 13, WERK_KOPPEN.length + 2);
  werk.cel(1, 1, true).v = 'Begin meting 20/08/2025';
  werk.cel(1, 2, true).v = 'Boven';
  werk.cel(2, 1, true).v = 'Tijdstempel';
  WERK_KOPPEN.forEach((k, i) => { werk.cel(2, i + 2, true).v = k; });
  werk.cel(2, WERK_KOPPEN.length + 2, true).v = 'Controle afgewerkt?';
  werk.cel(3, 1, true).v = '20/08/2025'; // oude rij met de datum als tekst
  for (let i = 0; i < 12; i++) werk.cel(4 + i, 1, true).v = dag(i - 6); // vandaag = rij 10
  WERK_KOPPEN.forEach((k, i) => { werk.cel(8, i + 2, true).v = 'OK'; }); // twee dagen geleden ingevuld
  werk.cel(8, WERK_KOPPEN.length + 2, true).v = 'Ja';

  // --- dagtabblad 2: Magazijn en bufferzone (rij 2 = koppen, rij 3 = OK/NOK, vanaf rij 4 gegevens)
  const mag = qc.nieuwTab(TAB_MAGAZIJN, 3 + 5, 20);
  mag.cel(1, 1, true).v = 'Begin meting 12/09/2024';
  ['Datum', 'Temperatuur magazijn (in C°)', 'Temperatuur Koelkast eetzaal', 'Luchtvochtigheid magazijn (in %)20,7'].forEach((k, i) => { mag.cel(2, i + 1, true).v = k; });
  // kolom E: eerste punt. Het derde punt (K/L/M) heeft koppen maar geen selectievakjes; R is een lege kolom.
  MAGAZIJN_PUNTEN.forEach((punt) => {
    const c = letterNaarKolom(punt.ok);
    mag.cel(2, c, true).v = punt.kop;
    mag.cel(2, c + 2, true).v = 'Opmerking NOK';
    mag.cel(3, c, true).v = 'OK';
    mag.cel(3, c + 1, true).v = 'NOK';
  });
  const bereidMagazijn = (r) => {
    mag.cel(r, 1, true).f = `=IFS(B${r}="";"";A${r}="";NOW();TRUE;A${r})`;
    MAGAZIJN_PUNTEN.filter((x) => x.actief).forEach((punt) => {
      const c = letterNaarKolom(punt.ok);
      Object.assign(mag.cel(r, c, true), { v: false, dv: vakjeRegel() });
      Object.assign(mag.cel(r, c + 1, true), { v: false, dv: vakjeRegel() });
      mag.cel(r, c + 2, true).f = `=if(${punt.ok}${r};"NVT";)`;
    });
  };
  for (let r = 4; r <= 8; r++) bereidMagazijn(r);
  // twee ingevulde dagen: rij 4 (drie dagen geleden, alles OK) en rij 5 (gisteren, één NOK)
  [[4, -3], [5, -1]].forEach(([r, verschil]) => {
    const d = dag(verschil); d.setHours(8, 30);
    Object.assign(mag.cel(r, 1), { v: d, f: '' });
    mag.cel(r, 2, true).v = 24; mag.cel(r, 3, true).v = 3; mag.cel(r, 4, true).v = 55;
    MAGAZIJN_PUNTEN.filter((x) => x.actief).forEach((punt) => { mag.cel(r, letterNaarKolom(punt.ok)).v = true; });
  });
  Object.assign(mag.cel(5, letterNaarKolom('H')), { v: false });
  mag.cel(5, letterNaarKolom('I')).v = true;
  Object.assign(mag.cel(5, letterNaarKolom('J')), { v: 'heftruck vuil', f: '' });

  return { qc, tab, werk, mag, prod, pTab, poco, cTab, opId: { [ID_PROD]: prod, [ID_POCO]: poco }, QC_TAB };
}

module.exports = { maakFixture, QC_TAB, QC_KOPPEN, OPERATOREN, OK3, OK4, JA_NEE, TRECHTERS, FORMULE_KOLOMMEN, TAB_WERK, TAB_MAGAZIJN, WERK_KOPPEN, MAGAZIJN_PUNTEN, dag, iso };
