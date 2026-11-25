// Genera los PDF de muestra a partir de samples/fuentes/*.html.
// Hace falta playwright (npm i -D playwright && npx playwright install chromium).
// Los PDF ya estan en el repo, solo hay que volver a ejecutar esto si se tocan las plantillas.
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'samples');
const navegador = await chromium.launch();
const pagina = await navegador.newPage();
for (const f of readdirSync(path.join(raiz, 'fuentes')).filter((x) => x.endsWith('.html'))) {
  await pagina.goto(pathToFileURL(path.join(raiz, 'fuentes', f)).href);
  const salida = path.join(raiz, 'pdf', f.replace('.html', '.pdf'));
  await pagina.pdf({ path: salida, format: 'A4', printBackground: true, preferCSSPageSize: true });
  console.log('generado', path.relative(process.cwd(), salida));
}
await navegador.close();
