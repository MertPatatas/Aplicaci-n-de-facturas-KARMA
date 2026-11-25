import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config } from '../src/config.js';
import { openDb } from '../src/db.js';

export const MUESTRAS = path.resolve(import.meta.dirname, '../../../samples/pdf');

export const muestra = (nombre: string) => fs.readFileSync(path.join(MUESTRAS, nombre));

export function entornoDePrueba(extra: Partial<Config> = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'facturas-test-'));
  const cfg: Config = {
    port: 0,
    dataDir,
    dbPath: ':memory:',
    pdfDir: path.join(dataDir, 'pdf'),
    timeZone: 'Europe/Madrid',
    ingestToken: 'token-de-prueba',
    anthropicKey: null,
    anthropicModel: 'modelo-de-prueba',
    webDir: null,
    ...extra,
  };
  return { cfg, db: openDb(':memory:') };
}
