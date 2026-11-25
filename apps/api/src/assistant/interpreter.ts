import type { DB } from '../db.js';
import { eur, normalizar } from '../util.js';
import { ETIQUETA_PERIODO, type Periodo } from './period.js';
import {
  contar, facturaMayor, listar, pendientesDeRevisar, proveedores, resumen, sumarImportes,
  type Consulta, type Contexto,
} from './tools.js';
import type { InvoiceSummary } from '../repo.js';

export interface RespuestaAsistente {
  answer: string;
  intent: string;
  invoices: InvoiceSummary[];
  mode: 'reglas' | 'modelo';
}

const SUFIJOS_SOCIEDAD = /\b(s\.?\s?l\.?\s?u?\.?|s\.?\s?a\.?|s\.?\s?coop\.?|c\.?\s?b\.?)\s*$/;

function detectarPeriodo(t: string): Periodo | undefined {
  if (/\bhoy\b|del dia|de hoy/.test(t)) return 'today';
  if (/\bayer\b/.test(t)) return 'yesterday';
  if (/esta semana|semana actual|esta ultima semana/.test(t)) return 'this_week';
  if (/este mes|mes actual/.test(t)) return 'this_month';
  return undefined;
}

function numero(s: string): number {
  return Number(s.replace(/\./g, '').replace(',', '.'));
}

function detectarImportes(t: string): Pick<Consulta, 'importeMinimo' | 'importeMaximo'> {
  const out: Pick<Consulta, 'importeMinimo' | 'importeMaximo'> = {};
  const cifra = '(\\d+(?:[.,]\\d+)*)';
  const min = t.match(new RegExp(`(?:superior|mayor|mas)\\s+(?:a|de|que)\\s+${cifra}`));
  const max = t.match(new RegExp(`(?:inferior|menor|menos)\\s+(?:a|de|que)\\s+${cifra}`));
  if (min) out.importeMinimo = numero(min[1]!);
  if (max) out.importeMaximo = numero(max[1]!);
  return out;
}

/**
 * Busca primero entre los proveedores que ya hay en la base. Vale el nombre completo
 * o su comienzo ("Transportes Norte" para "Transportes Norte Rapido S.L."); si no hay
 * coincidencia, toma lo que viene detras de la palabra "proveedor".
 */
function detectarProveedor(t: string, db: DB): string | undefined {
  const nombres = (db.prepare('SELECT name FROM suppliers').all() as { name: string }[]).map((r) => r.name);
  const texto = ' ' + t.replace(/[.,;:?!]/g, ' ').replace(/\s+/g, ' ') + ' ';
  let mejor = '';
  for (const n of nombres) {
    const palabras = normalizar(n).replace(SUFIJOS_SOCIEDAD, '').replace(/[.,]/g, ' ').trim().split(/\s+/);
    for (let k = palabras.length; k >= 1; k--) {
      const clave = palabras.slice(0, k).join(' ');
      if (clave.length >= 5 && texto.includes(' ' + clave + ' ')) {
        if (clave.length > mejor.length) mejor = clave;
        break;
      }
    }
  }
  if (mejor) return mejor;
  const m = t.match(/proveedor\s+(?:llamado\s+)?([a-z0-9&.\- ]+?)(?=\s+(?:hoy|ayer|esta|este|superior|mayor|inferior|menor|que|con)\b|[?!.,]|$)/);
  return m?.[1]?.trim() || undefined;
}

const AYUDA =
  'No he entendido la pregunta. Puedes preguntarme, por ejemplo: cuántas facturas han llegado hoy, si ha llegado alguna factura superior a 100 euros, ' +
  'el importe total facturado hoy, qué proveedores han enviado facturas esta semana, cuáles están pendientes de revisar o cuál es la factura de mayor importe.';

function textoFactura(f: InvoiceSummary): string {
  return `${f.supplierName ?? 'Proveedor desconocido'}, factura ${f.number ?? 'sin número'}, ${f.total != null ? eur(f.total) : 'sin importe'}`;
}

function conPeriodo(p: Periodo | undefined): string {
  return p && p !== 'all' ? ` ${ETIQUETA_PERIODO[p]}` : '';
}

export function responderPorReglas(pregunta: string, ctx: Contexto): RespuestaAsistente {
  const t = normalizar(pregunta);
  const periodo = detectarPeriodo(t);
  const consulta: Consulta = { ...detectarImportes(t) };
  if (periodo) consulta.periodo = periodo;
  const proveedor = detectarProveedor(t, ctx.db);
  if (proveedor) consulta.proveedor = proveedor;
  const filtroTexto =
    (consulta.proveedor ? ` del proveedor ${consulta.proveedor.replace(/\b\p{L}/gu, (c) => c.toUpperCase())}` : '') +
    (consulta.importeMinimo != null ? ` por encima de ${eur(consulta.importeMinimo)}` : '') +
    (consulta.importeMaximo != null ? ` por debajo de ${eur(consulta.importeMaximo)}` : '');
  const respuesta = (intent: string, answer: string, invoices: InvoiceSummary[] = []): RespuestaAsistente => ({ answer, intent, invoices, mode: 'reglas' });

  if (/resumen/.test(t)) {
    const c: Consulta = { ...consulta, periodo: consulta.periodo ?? 'today' };
    const r = resumen(ctx, c);
    const cuando = ETIQUETA_PERIODO[c.periodo!];
    if (!r.facturas) return respuesta('resumen', `Resumen de ${cuando}: no ha llegado ninguna factura. Hay ${r.pendientes} pendientes de revisar en total.`);
    const provs = r.proveedores.map((p) => p.nombre).join(', ');
    return respuesta(
      'resumen',
      `Resumen de ${cuando}: ${r.facturas} ${r.facturas === 1 ? 'factura' : 'facturas'} por un total de ${eur(r.total)}. ` +
        `Proveedores: ${provs}${provs.endsWith('.') ? '' : '.'} La de mayor importe es ${r.mayor ? textoFactura(r.mayor) : 'ninguna'}. ` +
        `En total hay ${r.pendientes} ${r.pendientes === 1 ? 'factura pendiente' : 'facturas pendientes'} de revisar.`,
      listar(ctx, c, 10),
    );
  }

  if (/pendiente/.test(t) && /revis|validar|validacion/.test(t)) {
    const c: Consulta = { ...consulta, estado: 'pending_review' };
    const lista = listar(ctx, c, 20);
    const n = pendientesDeRevisar(ctx);
    if (!n) return respuesta('pendientes', 'No hay ninguna factura pendiente de revisar.');
    return respuesta('pendientes', `Hay ${n} ${n === 1 ? 'factura pendiente' : 'facturas pendientes'} de revisar.`, lista);
  }

  if (/(que|cuales|quienes|cuantos)\s+proveedores|proveedores (han|ha)/.test(t)) {
    const p = proveedores(ctx, consulta);
    if (!p.length) return respuesta('proveedores', `No ha enviado facturas ningún proveedor${conPeriodo(consulta.periodo)}.`);
    return respuesta('proveedores', `Han enviado facturas${conPeriodo(consulta.periodo)}: ${p.map((x) => `${x.nombre} (${x.facturas}, ${eur(x.total)})`).join('; ')}.`);
  }

  if (/mayor importe|mas cara|mas grande|importe mas alto|factura mas alta/.test(t)) {
    const f = facturaMayor(ctx, consulta);
    if (!f) return respuesta('mayor', `No hay facturas${conPeriodo(consulta.periodo)}${filtroTexto}.`);
    return respuesta('mayor', `La factura de mayor importe${conPeriodo(consulta.periodo)} es de ${textoFactura(f)}.`, [f]);
  }

  if (/importe total|total facturado|cuanto (se ha )?factur|cuanto suman?|cuanto es el total|suma de las facturas/.test(t)) {
    const r = sumarImportes(ctx, consulta);
    if (!r.facturas) return respuesta('total', `No hay facturas${conPeriodo(consulta.periodo)}${filtroTexto}, el total es ${eur(0)}.`);
    return respuesta('total', `El importe total facturado${conPeriodo(consulta.periodo)}${filtroTexto} es ${eur(r.total)}, en ${r.facturas} ${r.facturas === 1 ? 'factura' : 'facturas'}.`);
  }

  if (/(ha|han) llegado alguna|hay alguna|alguna factura/.test(t)) {
    const lista = listar(ctx, consulta, 20);
    if (!lista.length) return respuesta('existe', `No, no hay ninguna factura${filtroTexto}${conPeriodo(consulta.periodo)}.`);
    return respuesta('existe', `Sí, ${lista.length === 1 ? 'hay 1 factura' : `hay ${lista.length} facturas`}${filtroTexto}${conPeriodo(consulta.periodo)}: ${lista.slice(0, 5).map(textoFactura).join('; ')}.`, lista);
  }

  if (/cuantas|cuantos|numero de facturas|cantidad de facturas/.test(t)) {
    const n = contar(ctx, consulta);
    return respuesta('contar', `${n === 0 ? 'No hay ninguna factura' : n === 1 ? 'Hay 1 factura' : `Hay ${n} facturas`}${filtroTexto}${conPeriodo(consulta.periodo)}.`, n ? listar(ctx, consulta, 10) : []);
  }

  if (/lista|muestra|dime las facturas|ensename|facturas de|facturas del/.test(t)) {
    const lista = listar(ctx, consulta, 20);
    if (!lista.length) return respuesta('listar', `No hay facturas${filtroTexto}${conPeriodo(consulta.periodo)}.`);
    return respuesta('listar', `Facturas${filtroTexto}${conPeriodo(consulta.periodo)}: ${lista.slice(0, 8).map(textoFactura).join('; ')}.`, lista);
  }

  return respuesta('desconocida', AYUDA);
}
