import type { InvoiceData, Line } from './types';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Importe de una linea a partir de cantidad, precio y descuento. */
export function importeLinea(l: Line): number | null {
  if (l.quantity == null || l.unitPrice == null) return l.total;
  return r2(l.quantity * l.unitPrice * (1 - (l.discountPct ?? 0) / 100));
}

/**
 * Recalcula importes de linea, base imponible, cuotas y total.
 * Si hay un unico impuesto, su base y su cuota se rehacen a partir de la nueva base.
 */
export function recalcular(d: InvoiceData): InvoiceData {
  const lines = d.lines.map((l) => ({ ...l, total: importeLinea(l) }));
  const subtotal = lines.every((l) => l.total != null) && lines.length ? r2(lines.reduce((a, l) => a + l.total!, 0)) : d.subtotal;
  let taxes = d.taxes;
  if (taxes.length === 1 && subtotal != null) {
    const t = taxes[0]!;
    taxes = [{ ...t, base: subtotal, amount: r2((subtotal * t.rate) / 100) * (t.type === 'IRPF' ? -1 : 1) }];
  }
  const taxTotal = taxes.length ? r2(taxes.reduce((a, t) => a + (t.amount ?? 0), 0)) : d.taxTotal;
  const total = subtotal != null && taxTotal != null ? r2(subtotal + taxTotal) : d.total;
  return { ...d, lines, taxes, subtotal, taxTotal, total };
}

/** Avisos de coherencia que se actualizan mientras se edita. */
export function revisar(d: InvoiceData): string[] {
  const out: string[] = [];
  const suma = d.lines.length && d.lines.every((l) => l.total != null) ? r2(d.lines.reduce((a, l) => a + l.total!, 0)) : null;
  if (suma != null && d.subtotal != null && Math.abs(suma - d.subtotal) > 0.02) {
    out.push(`La suma de las líneas (${suma.toFixed(2)}) no coincide con la base imponible (${d.subtotal.toFixed(2)}).`);
  }
  if (d.subtotal != null && d.taxTotal != null && d.total != null && Math.abs(d.subtotal + d.taxTotal - d.total) > 0.02) {
    out.push(`Base más impuestos (${r2(d.subtotal + d.taxTotal).toFixed(2)}) no coincide con el total (${d.total.toFixed(2)}).`);
  }
  for (const l of d.lines) {
    const calculado = importeLinea(l);
    if (l.total != null && calculado != null && l.quantity != null && l.unitPrice != null && Math.abs(calculado - l.total) > 0.02) {
      out.push(`En "${l.description.slice(0, 30)}" cantidad x precio da ${calculado.toFixed(2)} y el importe es ${l.total.toFixed(2)}.`);
    }
  }
  return out;
}

/** Errores que impiden guardar. */
export function validar(d: InvoiceData): string[] {
  const out: string[] = [];
  for (const [clave, p] of [['emisor', d.supplier], ['cliente', d.customer]] as const) {
    if (p && !p.name.trim()) out.push(`El nombre del ${clave} es obligatorio si se rellena algún otro dato.`);
  }
  if (d.lines.some((l) => !l.description.trim())) out.push('Todas las líneas necesitan un concepto.');
  if (d.currency.trim().length !== 3) out.push('La moneda debe tener 3 letras (EUR).');
  return out;
}
