// Wachtrij en synchronisatie. Wordt gebruikt door de pagina en door de service
// worker (Background Sync). Gebruikt daarom geen DOM.
import * as db from './db.js';
import { roep } from './api.js';
import { bouwVerzoek } from './model.js';

const WACHT_S = [5, 15, 60, 120]; // oplopende wachttijd, daarna elke 2 minuten
const SLOT = 'qc-rondgang-sync';
export const SYNC_TAG = 'qc-wachtrij';

const kanaal = 'BroadcastChannel' in self ? new BroadcastChannel('qc-rondgang') : null;
export function meld(type) {
  if (kanaal) kanaal.postMessage({ type });
}

const itemId = (appId, deel) => `controle:${appId}:${deel}`;

/** Zet een afgesloten deel in de wachtrij. Eén item per deel, nooit dubbel. */
export async function inWachtrij(appId, deel) {
  await db.zet('wachtrij', {
    id: itemId(appId, deel), soort: 'controle', appId, deel,
    sinds: Date.now(), pogingen: 0, laatsteFout: null, geenVerbinding: false, nietVoor: 0
  });
  meld('wachtrij');
  vraagAchtergrondSync();
}

export async function uitWachtrij(appId, deel) {
  await db.wis('wachtrij', itemId(appId, deel));
  meld('wachtrij');
}

/** Vraagt Chrome om de wachtrij ook te verzenden als de app gesloten is. */
export async function vraagAchtergrondSync() {
  try {
    const reg = self.registration || (navigator.serviceWorker && (await navigator.serviceWorker.ready));
    if (reg && 'sync' in reg) await reg.sync.register(SYNC_TAG);
  } catch (e) {
    // Niet ondersteund of geweigerd: de app verzendt dan alleen als ze open staat.
  }
}

/** Toestand voor de balk bovenaan. */
export async function toestand() {
  const items = await db.alle('wachtrij');
  const controles = new Set(items.filter((i) => i.soort === 'controle').map((i) => i.appId)).size;
  const fotos = items.filter((i) => i.soort === 'foto').length;
  // Geen verbinding is geen fout: dat is de gewone toestand in de productiezone.
  const metFout = items.filter((i) => i.laatsteFout && !i.geenVerbinding).sort((a, b) => b.nietVoor - a.nietVoor)[0];
  const volgende = items.length ? Math.min(...items.map((i) => i.nietVoor)) : null;
  return {
    aantal: items.length, controles, fotos, volgende,
    fout: metFout ? metFout.laatsteFout : null,
    geenVerbinding: items.some((i) => i.geenVerbinding)
  };
}

/**
 * Herstel: een deel dat op "klaar" staat zonder item in de wachtrij komt er
 * opnieuw in. Dubbel verzenden kan geen kwaad, het script herkent het app-ID.
 */
export async function herstelWachtrij() {
  const controles = await db.alle('controles');
  const items = new Set((await db.alle('wachtrij')).map((i) => i.id));
  for (const c of controles) {
    for (const deel of Object.keys(c.delen)) {
      if (c.delen[deel].status === 'klaar' && !items.has(itemId(c.appId, deel))) await inWachtrij(c.appId, deel);
    }
  }
}

let bezig = false;
export const isBezig = () => bezig;

/**
 * Verzendt de wachtrij: één verzoek tegelijk, in volgorde. Geeft de toestand
 * na afloop terug. handmatig = true negeert de wachttijd na een fout.
 */
export async function verwerk({ handmatig = false } = {}) {
  const run = async () => {
    bezig = true;
    meld('sync');
    try {
      await verwerkNu(handmatig);
    } finally {
      bezig = false;
      meld('sync');
    }
    return toestand();
  };
  if (navigator.locks) {
    // Web Locks: de pagina en de service worker verzenden nooit tegelijk.
    return navigator.locks.request(SLOT, { ifAvailable: true }, (slot) => (slot ? run() : toestand()));
  }
  if (bezig) return toestand();
  return run();
}

async function verwerkNu(handmatig) {
  await herstelWachtrij();
  const items = (await db.alle('wachtrij')).sort((a, b) => a.sinds - b.sinds);
  for (const item of items) {
    if (item.soort !== 'controle') continue; // foto's: fase 2
    if (!handmatig && item.nietVoor > Date.now()) continue;

    const controle = await db.haal('controles', item.appId);
    const deel = controle && controle.delen[item.deel];
    if (!deel || deel.status !== 'klaar') {
      // Heropend voor correctie of verwijderd: niets te verzenden.
      await db.wis('wachtrij', item.id);
      meld('wachtrij');
      continue;
    }
    const versie = deel.versie;
    // Vanaf nu kan dit deel in de sheet staan, ook als de bevestiging verloren
    // gaat. De controle mag dan niet meer van de tablet verwijderd worden.
    if (navigator.onLine !== false && !deel.geprobeerd) {
      const er = await db.werkBij('controles', item.appId, (c) => { c.delen[item.deel].geprobeerd = true; });
      if (!er) { await db.wis('wachtrij', item.id); meld('wachtrij'); continue; } // net verwijderd
    }

    try {
      const antwoord = await roep('controle', bouwVerzoek(controle, item.deel));
      // Alleen een bevestiging met hetzelfde app-ID telt.
      if (antwoord.appId !== item.appId || antwoord.deel !== item.deel) {
        throw Object.assign(new Error('De bevestiging hoort niet bij deze controle.'), { netwerk: true });
      }
      let verzonden = false;
      await db.werkBij('controles', item.appId, (c) => {
        const d = c.delen[item.deel];
        // Intussen gecorrigeerd? Dan blijft het deel wachten op de nieuwe versie.
        if (d.status !== 'klaar' || d.versie !== versie) return false;
        d.status = 'verzonden';
        d.verzondenOm = Date.now();
        d.rij = antwoord.rij;
        verzonden = true;
      });
      if (verzonden) await db.wis('wachtrij', item.id);
      meld('wachtrij');
    } catch (e) {
      item.pogingen += 1;
      item.laatsteFout = e.message || String(e);
      item.geenVerbinding = !!e.verbinding;
      item.nietVoor = Date.now() + WACHT_S[Math.min(item.pogingen - 1, WACHT_S.length - 1)] * 1000;
      await db.zet('wachtrij', item);
      meld('wachtrij');
      // Geen verbinding of verkeerde sleutel: de rest zal ook mislukken.
      if (e.netwerk || e.code === 'SLEUTEL' || e.code === 'INSTELLING') break;
    }
  }
}
