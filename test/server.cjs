// Testserver: de app op http://localhost:8787/qc-rondgang/ (subpad, zoals op
// GitHub Pages) en een nagebootste Apps Script web-app op een ANDERE oorsprong
// (http://127.0.0.1:8788), zodat de aanroep echt cross-origin is.
//
// Los te starten om de app in een browser te bekijken:  node test/server.cjs
const http = require('http');
const fs = require('fs');
const path = require('path');
const { laadScript } = require('./nep-apps-script.cjs');
const { maakFixture } = require('./fixture.cjs');

const APP_MAP = path.join(__dirname, '..', 'docs');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function start({ appPoort = 8787, scriptPoort = 8788 } = {}) {
  const staat = {
    fx: null, script: null, sleutel: null,
    verlies: 0,        // zoveel antwoorden op verliesActie gaan verloren NA het schrijven
    verliesActie: 'controle',
    weiger: [],        // acties die het script tijdelijk weigert (antwoord: fout)
    html: 0,           // zoveel antwoorden zijn een HTML-foutpagina
    preflights: 0,     // OPTIONS-verzoeken (moet 0 blijven)
    nieuweVersie: '',  // nabootsen dat er een nieuwe versie van de app online staat
    nieuweVersieZonderSw: false,
    verzoeken: [],     // alle ontvangen acties
    reset(opties) {
      this.fx = maakFixture(opties);
      // QC_SHEETS=1: met de nagebootste Sheets API, zoals op de echte sheet.
      this.script = laadScript({ actief: this.fx.qc, opId: this.fx.opId, sheetsDienst: process.env.QC_SHEETS === '1' });
      this.script.roep('installeer');
      this.sleutel = this.script.props.SLEUTEL;
      this.verlies = 0; this.verliesActie = 'controle'; this.weiger = []; this.html = 0; this.preflights = 0; this.verzoeken = []; this.nieuweVersie = ''; this.nieuweVersieZonderSw = false;
    }
  };
  staat.reset();

  const app = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/qc-rondgang/')) { res.writeHead(404); res.end('niet gevonden'); return; }
    let rel = url.pathname.slice('/qc-rondgang/'.length) || 'index.html';
    const bestand = path.join(APP_MAP, path.normalize(rel));
    if (!bestand.startsWith(APP_MAP) || !fs.existsSync(bestand) || fs.statSync(bestand).isDirectory()) { res.writeHead(404); res.end('niet gevonden'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(bestand)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    let inhoud = fs.readFileSync(bestand);
    // Nabootsen dat er een nieuwe versie van de app online staat.
    if (staat.nieuweVersie && rel === 'js/versie.js') inhoud = Buffer.from(inhoud.toString('utf8').replace(/APP_VERSIE = '[^']+'/, "APP_VERSIE = '" + staat.nieuweVersie + "'"));
    // Net als bij een echte uitgave wijzigt in sw.js alleen het versienummer.
    // nieuweVersieZonderSw bootst de fout van vóór 1.6.2 na: sw.js blijft gelijk.
    if (staat.nieuweVersie && !staat.nieuweVersieZonderSw && rel === 'sw.js') inhoud = Buffer.from(inhoud.toString('utf8').replace(/SW_VERSIE = '[^']+'/, "SW_VERSIE = '" + staat.nieuweVersie + "'"));
    res.end(inhoud);
  });

  const echo = new Map();
  let teller = 0;
  const script = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { staat.preflights++; res.writeHead(405); res.end(); return; } // Apps Script kent geen preflight
    if (req.method === 'GET' && url.pathname.startsWith('/echo/')) {
      const tekst = echo.get(url.pathname);
      echo.delete(url.pathname);
      res.writeHead(tekst ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(tekst || '{}');
      return;
    }
    if (req.method === 'POST' && url.pathname === '/macros/s/NEP/exec') {
      const stukken = [];
      req.on('data', (d) => stukken.push(d));
      req.on('end', () => {
        const body = Buffer.concat(stukken).toString('utf8');
        let actie = '?';
        try { actie = JSON.parse(body).actie; } catch (e) { /* laat het script de fout geven */ }
        staat.verzoeken.push({ actie, type: req.headers['content-type'] });
        if (staat.html > 0) {
          staat.html--;
          res.writeHead(200, { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': '*' });
          res.end('<html><body>Er is een fout opgetreden</body></html>');
          return;
        }
        const uit = staat.weiger.includes(actie)
          ? JSON.stringify({ ok: false, code: 'FOUT', fout: 'Tijdelijk geweigerd door de test.' })
          : JSON.stringify(staat.script.post(body));
        if (actie === staat.verliesActie && staat.verlies > 0) {
          staat.verlies--;
          // Geschreven in de sheet, maar de bevestiging komt nooit volledig aan:
          // de verbinding valt weg midden in het antwoord.
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': 500, 'Access-Control-Allow-Origin': '*' });
          res.write('{"ok":tr');
          setTimeout(() => req.socket.destroy(), 50);
          return;
        }
        // Zoals Apps Script: het antwoord komt via een omleiding.
        const pad = '/echo/' + (++teller);
        echo.set(pad, uit);
        res.writeHead(302, { Location: pad, 'Access-Control-Allow-Origin': '*' });
        res.end();
      });
      return;
    }
    res.writeHead(404); res.end();
  });

  return new Promise((resolve) => {
    app.listen(appPoort, '127.0.0.1', () => script.listen(scriptPoort, '127.0.0.1', () => resolve({
      staat,
      appUrl: `http://localhost:${appPoort}/qc-rondgang/`,
      scriptUrl: `http://127.0.0.1:${scriptPoort}/macros/s/NEP/exec`,
      stop: () => new Promise((r) => { app.closeAllConnections(); script.closeAllConnections(); app.close(() => script.close(r)); })
    })));
  });
}

module.exports = { start };

if (require.main === module) {
  start().then((s) => {
    console.log('App:     ' + s.appUrl);
    console.log('Script:  ' + s.scriptUrl);
    console.log('Sleutel: ' + s.staat.sleutel);
  });
}
