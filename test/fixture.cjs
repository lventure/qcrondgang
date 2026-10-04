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
  AK: 'Foto ZK & Gewichtsfiche', AL: 'Foto etiket (indien achteraan)', AN: 'Grondstof', AO: 'LOT GRD', AP: 'GRD correct?', AQ: 'Allergenen',
  AR: 'Allergenetiket aanwezig en correct?', AS: 'Trechter + mes?', AT: 'Gesloten circuits - Orde en netheid - Spillage', AU: 'Opmerkingen boven',
  AV: 'Grondstof & Zakje verschillend lot?', AW: 'Allergenen gelijk?'
};

const OPERATOREN = ['AB', 'CD', 'EF', 'GH', 'IJ', 'KL', 'Interim/Flexi'];
const JA_NEE = ['JA', 'NEE'];
const OK3 = ['OK', 'NOK', 'NVT'];
const OK4 = ['OK', 'NOK', 'NVT', 'STOP'];
const TRECHTERS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const FORMULE_KOLOMMEN = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'M', 'O', 'P', 'AN', 'AO', 'AQ'];

/** Een voorbereide lege rij: formules, selectievakjes en keuzelijsten, zoals in de sheet. */
function bereidRijVoor(tab, r) {
  const zet = (l, x) => Object.assign(tab.cel(r, letterNaarKolom(l), true), x);
  FORMULE_KOLOMMEN.forEach((l) => zet(l, { f: `=FORMULE_${l}(I${r})`, v: '' }));
  ['L', 'N', 'AP', 'AR'].forEach((l) => zet(l, { v: false, dv: vakjeRegel() }));
  ['Q', 'R'].forEach((l) => zet(l, { dv: lijstRegel(OPERATOREN) }));
  ['S', 'W'].forEach((l) => zet(l, { dv: lijstRegel(JA_NEE) }));
  ['T', 'U', 'V'].forEach((l) => zet(l, { f: `=IF(S${r}="nee";"NVT";)`, dv: lijstRegel(OK3) }));
  zet('X', { f: `=if(W${r}="nee";"NVT";)`, dv: lijstRegel(OK3) });
  zet('Y', { dv: lijstRegel(['1', '2']) });
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
  const pTab = prod.nieuwTab('Productielijst', 40, 12);
  ['', '', '', '', '', 'Klant + Product', 'in te vullen', '', 'Inhoud ZK', 'g/ge/stuks/mL', 'LOT ZK', ''].forEach((k, i) => { pTab.cel(1, i + 1, true).v = k; });
  vulTabel(pTab, 2,
    ['Nr', 'Prod.Code', 'Status', 'Klant + Product', 'Lijn', 'Inhoud ZK', 'g/ge/stuks/mL', 'Grondstof', 'LOT GRD', 'Gewenst LOT ZK', 'LOT ZK', 'Allergenen'],
    [
      [1, 260001, 'Klaar', 'Testklant Kruidenmix 20g', 'L4', 20, 'g', 'Kruidenmix A', '111111', '', 'LOT: 2600000001', 'Geen Allergenen'],
      [2, 260002, 'Klaar', 'Testklant Saus 10ml', 'L6', 10, 'mL', 'Saus B', '222222', '', 'LOT: 2600000002', 'mosterd'],
      [3, 260101, 'In productie', 'Voorbeeld Energiegel 40g', 'GELPACK 1', 40, 'g', 'Gelbasis C', '333333', '', 'LOT: 2600000101', 'Geen Allergenen'],
      [4, 260102, 'In productie', 'Voorbeeld Proteïne 100ge', 'L8', 100, 'ge', 'Proteïnepoeder D', '444444', '', 'LOT: 2600000102', 'melk - soja'],
      [5, 260103, 'Klaar voor productie', 'Voorbeeld Suikersticks 5g', 'STICKS', 5, 'g', 'Suiker E', '555555', '', 'LOT: 2600000103', 'Geen Allergenen'],
      [6, 260104, 'Onvolledig', 'Voorbeeld Notenmix 30g', 'L7', 30, 'g', 'Notenmix F', '666666', '', 'LOT: 2600000104', 'gluten - pinda'],
      [7, 260105, 'KLAAR', 'Voorbeeld Afgewerkt 15g', 'L4', 15, 'g', 'Poeder G', '777777', '', 'LOT: 2600000105', ''],
      [8, 260106, '', '', '#N/A', '', '', '', '', '', '', ''],
      [9, 260107, 'In productie', 'Voorbeeld Zonder lijn 8g', '#N/A', 8, 'g', 'Poeder H', '888888', '', 'LOT: 2600000107', 'selderij']
    ]);

  // --- bron: pocolist (koppen in rij 1)
  const poco = new NepSpreadsheet('Pocolist (nep)');
  const cTab = poco.nieuwTab('pocolist', 40, 8);
  vulTabel(cTab, 1,
    ['', 'Palletnummer', 'asnartikelcode', 'asnlotn°', 'Toestand', 'Check1', 'Allergenen', 'Soort pallet'],
    [
      [1, 50001, 'ART TACO 30X30G', 439001, 'PALL. BL. VOORHAND.', 'KRUIDENMIX TACO 01', 'Geen Allergenen boven', 'Euro'],
      [2, 50002, 'ART GUA 40X20G', 439002, 'ONVOLL. PALLET', 'KRUIDENMIX GUA 02', 'mosterd', 'Euro'],
      [3, 50003, 'ART FAJ 25X30G', 439003, 'KLAAR', 'KRUIDENMIX FAJ 03', '', 'Euro'],
      [4, 50004, 'ART BUR 25X30G', 439004, 'KLAAR AX', 'KRUIDENMIX BUR 04', '', 'Euro'],
      [5, 50005, 'ART CHI 25X30G', 439005, 'Shipped', 'KRUIDENMIX CHI 05', '', 'Euro'],
      [6, 50006, 'ART NAC 25X30G', 439006, 'Wachten Klaar', 'KRUIDENMIX NAC 06', '', 'Euro'],
      [7, 50007, 'ART SAL 25X30G', 439007, '', 'KRUIDENMIX SAL 07', '', 'Euro'],
      [8, 50008, 'ART ENC 25X30G', 439008, 'VERNIETIGD', 'KRUIDENMIX ENC 08', '', 'Euro'],
      [9, 50009, 'ART QUE 25X30G', 439009, 'niet gebruikt', 'KRUIDENMIX QUE 09', '', 'Euro'],
      [10, 50010, '', '', 'Wachten', '', '', '']
    ]);

  // --- importtabbladen in de QC-sheet: alleen de IMPORTRANGE-formule telt
  const imp1 = qc.nieuwTab('ImportProductielijst', 40, 13);
  imp1.cel(1, 2, true).f = `=IMPORTRANGE("${ID_PROD}";"Productielijst!A:Cd")`;
  const imp2 = qc.nieuwTab('poco list', 40, 8);
  imp2.cel(1, 1, true).f = `=IMPORTRANGE("https://docs.google.com/spreadsheets/d/${ID_POCO}/edit";"pocolist!1:6000")`;

  return { qc, tab, prod, pTab, poco, cTab, opId: { [ID_PROD]: prod, [ID_POCO]: poco }, QC_TAB };
}

module.exports = { maakFixture, QC_TAB, QC_KOPPEN, OPERATOREN, OK3, OK4, JA_NEE, TRECHTERS, FORMULE_KOLOMMEN };
