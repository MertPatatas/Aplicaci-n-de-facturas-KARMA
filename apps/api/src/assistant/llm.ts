import type { Config } from '../config.js';
import type { RespuestaAsistente } from './interpreter.js';
import type { Periodo } from './period.js';
import {
  contar, facturaMayor, listar, pendientesDeRevisar, proveedores, resumen, sumarImportes,
  type Consulta, type Contexto,
} from './tools.js';
import type { InvoiceSummary } from '../repo.js';

const FILTROS = {
  periodo: { type: 'string', enum: ['today', 'yesterday', 'this_week', 'this_month', 'all'], description: 'Periodo de LLEGADA de la factura al correo. Por defecto all.' },
  estado: { type: 'string', enum: ['pending_review', 'validated', 'rejected'] },
  proveedor: { type: 'string', description: 'Parte del nombre del proveedor' },
  importe_minimo: { type: 'number', description: 'Solo facturas con total mayor que este valor, en euros' },
  importe_maximo: { type: 'number', description: 'Solo facturas con total menor que este valor, en euros' },
};

const HERRAMIENTAS = [
  ['contar_facturas', 'Cuenta las facturas que cumplen los filtros.'],
  ['sumar_importes', 'Suma el importe total de las facturas que cumplen los filtros.'],
  ['listar_facturas', 'Lista las facturas que cumplen los filtros (máximo 20).'],
  ['factura_mayor_importe', 'Devuelve la factura de mayor importe entre las que cumplen los filtros.'],
  ['listar_proveedores', 'Proveedores con facturas que cumplen los filtros, con número e importe.'],
  ['resumen', 'Resumen: número de facturas, total, proveedores, la mayor y las pendientes de revisar.'],
  ['pendientes_de_revisar', 'Número de facturas pendientes de revisar en total.'],
].map(([name, description]) => ({
  name,
  description,
  input_schema: { type: 'object', properties: name === 'pendientes_de_revisar' ? {} : FILTROS },
}));

const SISTEMA = (hoy: string) =>
  `Eres el asistente de una aplicacion de facturas recibidas por correo. Hoy es ${hoy}. ` +
  'Contestas en español, de forma breve, usando SOLO los datos que devuelven las herramientas: no inventes cifras. ' +
  'Importes en euros con formato espanol. Si la pregunta no tiene que ver con las facturas, dilo en una frase.';

function aConsulta(i: Record<string, unknown>): Consulta {
  const c: Consulta = {};
  if (typeof i.periodo === 'string') c.periodo = i.periodo as Periodo;
  if (typeof i.estado === 'string') c.estado = i.estado as Consulta['estado'];
  if (typeof i.proveedor === 'string' && i.proveedor) c.proveedor = i.proveedor;
  if (typeof i.importe_minimo === 'number') c.importeMinimo = i.importe_minimo;
  if (typeof i.importe_maximo === 'number') c.importeMaximo = i.importe_maximo;
  return c;
}

function ejecutar(nombre: string, entrada: Record<string, unknown>, ctx: Contexto, vistas: Map<number, InvoiceSummary>): unknown {
  const c = aConsulta(entrada);
  const recordar = (fs: InvoiceSummary[]) => fs.forEach((f) => vistas.set(f.id, f));
  switch (nombre) {
    case 'contar_facturas': return { facturas: contar(ctx, c) };
    case 'sumar_importes': return sumarImportes(ctx, c);
    case 'listar_facturas': { const l = listar(ctx, c, 20); recordar(l); return l; }
    case 'factura_mayor_importe': { const f = facturaMayor(ctx, c); if (f) recordar([f]); return f; }
    case 'listar_proveedores': return proveedores(ctx, c);
    case 'resumen': { const r = resumen(ctx, c); if (r.mayor) recordar([r.mayor]); return r; }
    case 'pendientes_de_revisar': return { pendientes: pendientesDeRevisar(ctx) };
    default: return { error: `Herramienta desconocida: ${nombre}` };
  }
}

type Bloque = { type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string };

export async function responderConModelo(
  pregunta: string,
  ctx: Contexto,
  cfg: Pick<Config, 'anthropicKey' | 'anthropicModel'>,
  fetchFn: typeof fetch = fetch,
): Promise<RespuestaAsistente> {
  const hoy = new Intl.DateTimeFormat('es-ES', { dateStyle: 'full', timeZone: ctx.timeZone }).format(ctx.now);
  const mensajes: { role: 'user' | 'assistant'; content: unknown }[] = [{ role: 'user', content: pregunta }];
  const vistas = new Map<number, InvoiceSummary>();

  for (let vuelta = 0; vuelta < 6; vuelta++) {
    const res = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.anthropicKey!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: cfg.anthropicModel, max_tokens: 1024, system: SISTEMA(hoy), tools: HERRAMIENTAS, messages: mensajes }),
    });
    if (!res.ok) throw new Error(`El modelo respondio ${res.status}`);
    const cuerpo = (await res.json()) as { content: Bloque[]; stop_reason: string };
    if (cuerpo.stop_reason !== 'tool_use') {
      const texto = cuerpo.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { answer: texto || 'No he podido elaborar una respuesta.', intent: 'modelo', invoices: [...vistas.values()].slice(0, 20), mode: 'modelo' };
    }
    mensajes.push({ role: 'assistant', content: cuerpo.content });
    const resultados = cuerpo.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(ejecutar(b.name!, b.input ?? {}, ctx, vistas)) }));
    mensajes.push({ role: 'user', content: resultados });
  }
  throw new Error('El modelo no llego a una respuesta final');
}
