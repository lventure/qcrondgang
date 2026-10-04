// Lokale opslag (IndexedDB). Eigen naam, want Palletscan deelt dezelfde oorsprong.
const DB_NAAM = 'qc-rondgang';
const DB_VERSIE = 1;

// Pas bevestigen als het echt op de opslag staat, ook bij een plotse stroomuitval.
const STRIKT = { durability: 'strict' };

let dbBelofte = null;

function open() {
  if (!dbBelofte) {
    dbBelofte = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAAM, DB_VERSIE);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('instellingen')) db.createObjectStore('instellingen');
        if (!db.objectStoreNames.contains('referentie')) db.createObjectStore('referentie');
        if (!db.objectStoreNames.contains('controles')) db.createObjectStore('controles', { keyPath: 'appId' });
        if (!db.objectStoreNames.contains('wachtrij')) db.createObjectStore('wachtrij', { keyPath: 'id' });
        // Fase 2. Nu al aangemaakt, zodat er later geen migratie nodig is.
        if (!db.objectStoreNames.contains('fotos')) {
          db.createObjectStore('fotos', { keyPath: 'id' }).createIndex('appId', 'appId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbBelofte = null; reject(req.error); };
    });
  }
  return dbBelofte;
}

function klaar(tx, waarde) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(waarde());
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Opslag afgebroken'));
  });
}

export async function haal(store, sleutel) {
  const db = await open();
  const tx = db.transaction(store, 'readonly');
  const req = tx.objectStore(store).get(sleutel);
  return klaar(tx, () => req.result);
}

export async function alle(store) {
  const db = await open();
  const tx = db.transaction(store, 'readonly');
  const req = tx.objectStore(store).getAll();
  return klaar(tx, () => req.result);
}

export async function zet(store, waarde, sleutel) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite', STRIKT);
  if (sleutel === undefined) tx.objectStore(store).put(waarde); else tx.objectStore(store).put(waarde, sleutel);
  return klaar(tx, () => waarde);
}

export async function wis(store, sleutel) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite', STRIKT);
  tx.objectStore(store).delete(sleutel);
  return klaar(tx, () => undefined);
}

/**
 * Leest, wijzigt en bewaart een record in één transactie. Zo kunnen de pagina
 * en de synchronisatie elkaars wijzigingen niet overschrijven.
 * fn krijgt het record (of undefined) en mag het wijzigen; geeft fn false
 * terug, dan wordt er niets bewaard.
 */
export async function werkBij(store, sleutel, fn) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite', STRIKT);
  const os = tx.objectStore(store);
  let uit;
  const req = os.get(sleutel);
  req.onsuccess = () => {
    uit = req.result;
    if (uit === undefined) return;
    if (fn(uit) === false) return;
    os.put(uit);
  };
  return klaar(tx, () => uit);
}

/**
 * Wist een record alleen als fn(record) true geeft, in één transactie.
 * Geeft terug of er gewist is.
 */
export async function wisAls(store, sleutel, fn) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite', STRIKT);
  const os = tx.objectStore(store);
  let gewist = false;
  const req = os.get(sleutel);
  req.onsuccess = () => {
    if (req.result !== undefined && fn(req.result)) { os.delete(sleutel); gewist = true; }
  };
  return klaar(tx, () => gewist);
}

export const instelling = (naam) => haal('instellingen', naam);
export const zetInstelling = (naam, waarde) => zet('instellingen', waarde, naam);
