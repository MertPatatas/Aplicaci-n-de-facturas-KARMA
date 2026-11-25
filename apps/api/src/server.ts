import { createApp } from './app.js';
import { loadConfigFromEnvFile } from './config.js';
import { openDb } from './db.js';

const cfg = loadConfigFromEnvFile();
const db = openDb(cfg.dbPath);
const app = createApp({ db, cfg });

if (cfg.ingestToken === 'cambia-este-token') {
  console.warn('Aviso: INGEST_TOKEN tiene el valor de ejemplo. Cambialo en .env antes de exponer la API.');
}

app.listen(cfg.port, () => {
  console.log(`API en http://localhost:${cfg.port} (lector: ${cfg.anthropicKey ? 'modelo con respaldo por reglas' : 'reglas'})`);
});
