import type { DB } from '../db.js';
import { condicionesFiltro, listarFacturas, type InvoiceFilters, type InvoiceSummary } from '../repo.js';
import type { Status } from '../schema.js';
import { rangoPeriodo, type Periodo } from './period.js';

/** Filtros en el lenguaje del asistente: el periodo se resuelve a fechas aqui. */
export interface Consulta {
  periodo?: Periodo;
  estado?: Status;
  proveedor?: string;
  importeMinimo?: number;
  importeMaximo?: number;
}

export interface Contexto {
  db: DB;
  now: Date;
  timeZone: string;
}

export function aFiltros(c: Consulta, ctx: Contexto): InvoiceFilters {
  const { from, to } = rangoPeriodo(c.periodo ?? 'all', ctx.now, ctx.timeZone);
  const f: InvoiceFilters = {};
  if (from) f.receivedFrom = from;
  if (to) f.receivedTo = to;
  if (c.estado) f.status = c.estado;
  else f.excludeStatus = 'rejected'; // las rechazadas no cuentan en estadisticas
  if (c.proveedor) f.supplier = c.proveedor;
  if (c.importeMinimo != null) f.minTotal = c.importeMinimo;
  if (c.importeMaximo != null) f.maxTotal = c.importeMaximo;
  return f;
}

export function contar(ctx: Contexto, c: Consulta): number {
  const { where, params } = condicionesFiltro(aFiltros(c, ctx));
  const r = ctx.db
    .prepare(`SELECT COUNT(*) AS n FROM invoices i JOIN source_documents d ON d.id = i.source_document_id LEFT JOIN suppliers s ON s.id = i.supplier_id ${where}`)
    .get(...params) as { n: number };
  return r.n;
}

export function sumarImportes(ctx: Contexto, c: Consulta): { total: number; facturas: number } {
  const { where, params } = condicionesFiltro(aFiltros(c, ctx));
  const r = ctx.db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(i.total_cents), 0) AS suma
       FROM invoices i JOIN source_documents d ON d.id = i.source_document_id LEFT JOIN suppliers s ON s.id = i.supplier_id ${where}`,
    )
    .get(...params) as { n: number; suma: number };
  return { total: r.suma / 100, facturas: r.n };
}

export function listar(ctx: Contexto, c: Consulta, limite = 20): InvoiceSummary[] {
  return listarFacturas(ctx.db, aFiltros(c, ctx), limite);
}

export function facturaMayor(ctx: Contexto, c: Consulta): InvoiceSummary | null {
  const todas = listarFacturas(ctx.db, aFiltros(c, ctx), 1000).filter((f) => f.total != null);
  todas.sort((a, b) => b.total! - a.total!);
  return todas[0] ?? null;
}

export function proveedores(ctx: Contexto, c: Consulta): { nombre: string; facturas: number; total: number }[] {
  const { where, params } = condicionesFiltro(aFiltros(c, ctx));
  const rows = ctx.db
    .prepare(
      `SELECT s.name AS nombre, COUNT(*) AS facturas, COALESCE(SUM(i.total_cents), 0) AS suma
       FROM invoices i JOIN source_documents d ON d.id = i.source_document_id JOIN suppliers s ON s.id = i.supplier_id ${where}
       GROUP BY s.id ORDER BY suma DESC`,
    )
    .all(...params) as { nombre: string; facturas: number; suma: number }[];
  return rows.map((r) => ({ nombre: r.nombre, facturas: r.facturas, total: r.suma / 100 }));
}

export function pendientesDeRevisar(ctx: Contexto): number {
  const r = ctx.db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE status = 'pending_review'").get() as { n: number };
  return r.n;
}

export function resumen(ctx: Contexto, c: Consulta) {
  const { total, facturas } = sumarImportes(ctx, c);
  return {
    facturas,
    total,
    proveedores: proveedores(ctx, c),
    mayor: facturaMayor(ctx, c),
    pendientes: pendientesDeRevisar(ctx),
  };
}
