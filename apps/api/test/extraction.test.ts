import { describe, expect, it } from 'vitest';
import { interpretarFactura } from '../src/extraction/heuristic.js';
import { leerLineas } from '../src/extraction/pdf.js';
import { muestra } from './helpers.js';

const leer = async (nombre: string) => interpretarFactura(await leerLineas(new Uint8Array(muestra(nombre))));

const marlin = { name: 'Tecnologías Marlin S.L.', taxId: 'B98765432' };

describe('lector de facturas por reglas', () => {
  it('A: emisor y cliente en columnas, descuentos por linea', async () => {
    const { data, warnings } = await leer('A_suministros_iberricos.pdf');
    expect(data).toMatchObject({
      supplier: { name: 'Suministros Ibéricos S.L.', taxId: 'B46218353' },
      customer: marlin,
      number: 'SI-2026-0412',
      issueDate: '2026-10-27',
      dueDate: '2026-11-26',
      subtotal: 228.83,
      taxTotal: 48.05,
      total: 276.88,
    });
    expect(data.taxes).toEqual([{ type: 'IVA', rate: 21, base: null, amount: 48.05 }]);
    expect(data.lines).toEqual([
      { description: 'Papel A4 80 g (caja 5 paquetes)', quantity: 4, unitPrice: 24.5, discountPct: 0, taxRate: null, total: 98 },
      { description: 'Tóner negro compatible HP 305A', quantity: 3, unitPrice: 38.9, discountPct: 10, taxRate: null, total: 105.03 },
      { description: 'Archivador de palanca A4 lomo ancho', quantity: 12, unitPrice: 2.15, discountPct: 0, taxRate: null, total: 25.8 },
    ]);
    expect(warnings).toEqual([]);
  });

  it('B: sin rotulos, fechas escritas, dos tipos de IVA en tabla', async () => {
    const { data, warnings } = await leer('B_graficas_levante.pdf');
    expect(data).toMatchObject({
      supplier: { name: 'Gráficas Levante S.A.', taxId: 'A46093827' },
      customer: marlin,
      number: '2026/0087',
      issueDate: '2026-10-14',
      dueDate: '2026-11-13',
      subtotal: 534,
      taxTotal: 67.94,
      total: 601.94,
    });
    expect(data.taxes).toEqual([
      { type: 'IVA', rate: 21, base: 274, amount: 57.54 },
      { type: 'IVA', rate: 4, base: 260, amount: 10.4 },
    ]);
    expect(data.lines.map((l) => [l.quantity, l.unitPrice, l.taxRate, l.total])).toEqual([
      [2, 32, 21, 64],
      [500, 0.42, 21, 210],
      [40, 6.5, 4, 260],
    ]);
    expect(warnings).toEqual([]);
  });

  it('C: autonomo con retencion de IRPF y bloques apilados', async () => {
    const { data, warnings } = await leer('C_estudio_arrabal.pdf');
    expect(data).toMatchObject({
      supplier: { name: 'María Arrabal Gil', taxId: '53412987P' },
      customer: marlin,
      number: '26-031',
      issueDate: '2026-11-03',
      dueDate: null,
      subtotal: 1980,
      taxTotal: 118.8,
      total: 2098.8,
    });
    expect(data.taxes).toEqual([
      { type: 'IVA', rate: 21, base: null, amount: 415.8 },
      { type: 'IRPF', rate: 15, base: null, amount: -297 },
    ]);
    expect(data.lines.map((l) => [l.quantity, l.unitPrice, l.total])).toEqual([
      [30, 60, 1800],
      [3, 60, 180],
    ]);
    expect(warnings).toEqual([]);
  });

  it('D: cabecera con valores debajo y descripcion en dos lineas', async () => {
    const { data, warnings } = await leer('D_transportes_norte.pdf');
    expect(data).toMatchObject({
      supplier: { name: 'Transportes Norte Rápido S.L.', taxId: 'B15876203' },
      customer: marlin,
      number: 'TN-2026-1187',
      issueDate: '2026-10-30',
      dueDate: '2026-12-29',
      subtotal: 1220.9,
      taxTotal: 256.39,
      total: 1477.29,
    });
    expect(data.lines).toHaveLength(3);
    expect(data.lines[0]).toMatchObject({
      description: 'Transporte paletizado Valencia - Madrid (servicio urgente, entrega en 24 horas desde la recogida)',
      quantity: 6,
      unitPrice: 185,
      total: 1110,
    });
    expect(warnings).toEqual([]);
  });

  it('E: un PDF que no es factura sale con avisos y sin inventar datos', async () => {
    const { data, warnings } = await leer('E_no_es_factura.pdf');
    expect(data.number).toBeNull();
    expect(data.total).toBeNull();
    expect(data.lines).toEqual([]);
    expect(warnings.length).toBeGreaterThanOrEqual(4);
  });

  it('un PDF sin texto avisa de que puede ser un escaneo', () => {
    const { warnings } = interpretarFactura([]);
    expect(warnings[0]).toMatch(/escaneo/);
  });
});
