import { beforeAll, describe, expect, it } from 'vitest';
import { responderPorReglas } from '../src/assistant/interpreter.js';
import { cambiarEstado } from '../src/repo.js';
import { ingestarPdf } from '../src/ingest.js';
import { entornoDePrueba, muestra } from './helpers.js';

// Domingo 22/11/2026, 11:00 en Madrid
const NOW = new Date('2026-11-22T10:00:00Z');
const { cfg, db } = entornoDePrueba();
const ctx = { db, now: NOW, timeZone: cfg.timeZone };
const pregunta = (t: string) => responderPorReglas(t, ctx);

beforeAll(async () => {
  const entradas: [string, string][] = [
    ['A_suministros_iberricos.pdf', '2026-11-22T08:00:00Z'], // hoy
    ['B_graficas_levante.pdf', '2026-11-22T09:30:00Z'], // hoy
    ['C_estudio_arrabal.pdf', '2026-11-20T12:00:00Z'], // esta semana
    ['D_transportes_norte.pdf', '2026-11-10T12:00:00Z'], // este mes
  ];
  for (const [f, receivedAt] of entradas) await ingestarPdf({ db, cfg }, { buffer: muestra(f), filename: f, receivedAt });
});

describe('asistente por reglas, sobre la base de datos', () => {
  it('cuantas facturas han llegado hoy', () => {
    const r = pregunta('¿Cuántas facturas han llegado hoy?');
    expect(r.intent).toBe('contar');
    expect(r.answer).toContain('Hay 2 facturas hoy');
  });

  it('ha llegado alguna superior a 100 euros', () => {
    const r = pregunta('¿Ha llegado alguna factura superior a 100 €?');
    expect(r.intent).toBe('existe');
    expect(r.invoices).toHaveLength(4);
    const hoy = pregunta('¿Ha llegado alguna factura superior a 100 euros hoy?');
    expect(hoy.invoices.map((f) => f.number).sort()).toEqual(['2026/0087', 'SI-2026-0412']);
    const alta = pregunta('¿Ha llegado alguna factura superior a 1.000 euros?');
    expect(alta.invoices.map((f) => f.number).sort()).toEqual(['26-031', 'TN-2026-1187']);
    expect(pregunta('hay alguna factura superior a 5000 euros').answer).toMatch(/^No/);
  });

  it('ha llegado alguna del proveedor X, con y sin acentos', () => {
    const r = pregunta('¿Ha llegado alguna factura del proveedor Graficas Levante?');
    expect(r.invoices).toHaveLength(1);
    expect(r.invoices[0]!.supplierName).toBe('Gráficas Levante S.A.');
    const r2 = pregunta('¿Ha llegado alguna factura de Transportes Norte?');
    expect(r2.invoices[0]!.number).toBe('TN-2026-1187');
    expect(pregunta('¿Ha llegado alguna factura del proveedor Inexistente?').answer).toMatch(/^No/);
  });

  it('importe total facturado hoy', () => {
    const r = pregunta('¿Cuál ha sido el importe total facturado hoy?');
    expect(r.intent).toBe('total');
    expect(r.answer).toMatch(/878,82/);
    expect(r.answer).toContain('2 facturas');
  });

  it('que proveedores han enviado facturas esta semana', () => {
    const r = pregunta('¿Qué proveedores han enviado facturas esta semana?');
    expect(r.intent).toBe('proveedores');
    expect(r.answer).toContain('Suministros Ibéricos');
    expect(r.answer).toContain('Gráficas Levante');
    expect(r.answer).toContain('María Arrabal Gil');
    expect(r.answer).not.toContain('Transportes Norte');
  });

  it('factura de mayor importe recibida hoy', () => {
    const r = pregunta('¿Cuál es la factura de mayor importe recibida hoy?');
    expect(r.intent).toBe('mayor');
    expect(r.invoices[0]!.number).toBe('2026/0087');
    expect(r.answer).toMatch(/601,94/);
  });

  it('resumen del dia', () => {
    const r = pregunta('Hazme un resumen del día');
    expect(r.intent).toBe('resumen');
    expect(r.answer).toContain('2 facturas');
    expect(r.answer).toMatch(/878,82/);
    expect(r.answer).toContain('4 facturas pendientes');
  });

  it('pendientes de revisar cambia al validar y las rechazadas no cuentan', () => {
    expect(pregunta('¿Hay alguna factura pendiente de revisar?').invoices).toHaveLength(4);
    const id = pregunta('¿Cuál es la factura de mayor importe recibida hoy?').invoices[0]!.id;
    cambiarEstado(db, id, 'validated');
    const r = pregunta('¿Hay alguna factura pendiente de revisar?');
    expect(r.invoices).toHaveLength(3);
    expect(r.answer).toContain('3 facturas pendientes');
    cambiarEstado(db, id, 'rejected');
    expect(pregunta('¿Cuántas facturas han llegado hoy?').answer).toContain('Hay 1 factura hoy');
  });

  it('una pregunta que no entiende devuelve ayuda', () => {
    const r = pregunta('¿Qué tiempo hará mañana?');
    expect(r.intent).toBe('desconocida');
    expect(r.answer).toContain('No he entendido');
  });
});
