// Envia los PDF de samples/pdf a la API por el mismo endpoint que usa n8n.
// Sirve para probar el sistema sin tener un correo configurado.
//   npm run muestras:enviar                      (API en http://localhost:3001)
//   API_URL=http://localhost:3001 INGEST_TOKEN=... npm run muestras:enviar -- --todas
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const api = process.env.API_URL ?? 'http://localhost:3001';
const token = process.env.INGEST_TOKEN ?? 'cambia-este-token';
const incluirNoFactura = process.argv.includes('--todas');
const carpeta = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'samples', 'pdf');

for (const f of readdirSync(carpeta).filter((x) => x.endsWith('.pdf')).sort()) {
  if (!incluirNoFactura && f.startsWith('E_')) continue;
  const form = new FormData();
  form.append('file', new Blob([readFileSync(path.join(carpeta, f))], { type: 'application/pdf' }), f);
  form.append('messageId', `<muestra-${f}@local.test>`);
  form.append('from', 'facturacion@ejemplo.test');
  form.append('subject', `Factura adjunta (${f})`);
  form.append('receivedAt', new Date().toISOString());
  const res = await fetch(`${api}/api/ingest`, { method: 'POST', headers: { 'x-ingest-token': token }, body: form });
  const cuerpo = await res.json().catch(() => ({}));
  console.log(f.padEnd(30), res.status, JSON.stringify(cuerpo));
}
