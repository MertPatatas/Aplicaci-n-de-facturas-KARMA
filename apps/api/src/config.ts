import path from 'node:path';

export interface Config {
  port: number;
  dataDir: string;
  dbPath: string;
  pdfDir: string;
  timeZone: string;
  ingestToken: string;
  anthropicKey: string | null;
  anthropicModel: string;
  webDir: string | null;
}

// Carga un .env de la raiz del repo si existe (Node 22 lo trae de serie).
function cargarEnv() {
  for (const ruta of ['.env', '../../.env']) {
    try {
      process.loadEnvFile(ruta);
      return;
    } catch {
      // no hay fichero en esa ruta, se prueba la siguiente
    }
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.DATA_DIR ?? './data');
  return {
    port: Number(env.PORT ?? 3001),
    dataDir,
    dbPath: path.join(dataDir, 'facturas.db'),
    pdfDir: path.join(dataDir, 'pdf'),
    timeZone: env.TZ_NEGOCIO ?? 'Europe/Madrid',
    ingestToken: env.INGEST_TOKEN ?? 'cambia-este-token',
    anthropicKey: env.ANTHROPIC_API_KEY?.trim() || null,
    anthropicModel: env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5',
    webDir: env.WEB_DIR ? path.resolve(env.WEB_DIR) : null,
  };
}

export function loadConfigFromEnvFile(): Config {
  cargarEnv();
  return loadConfig();
}
