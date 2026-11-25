import { emptyInvoice, type InvoiceData, type InvoiceLine, type InvoiceTax, type Party } from '../schema.js';
import { parseAmount, parseDate, redondear2 } from '../util.js';
import type { Cell, Line } from './pdf.js';

const NIF = /\b(?:[ABCDEFGHJNPQRSUVW]-?\d{7}-?[0-9A-J]|\d{8}-?[A-Z]|[XYZ]-?\d{7}-?[A-Z])\b/;
const DINERO = /-?\d{1,3}(?:\.\d{3})+,\d{1,2}|-?\d+,\d{1,2}|-?\d+\.\d{2}(?!\d)/g;
const ES_NUMERICA = /^[-−(]?\d[\d.,]*\)?\s*(?:€|EUR|%)?$/i;

const ETIQ_EMISOR = /^(emisor|proveedor|vendedor|datos del emisor|datos del proveedor|de)\s*:?$/i;
const ETIQ_CLIENTE = /^(cliente|facturar a|datos del cliente|receptor|destinatario|facturado a)\s*:?$/i;

const NUM_FACTURA = [
  /(?:factura|fra\.?)\s*n\.?\s*[ºo°]\.?\s*[:.]?/i,
  /n\.?\s*[ºo°]\.?\s*(?:de\s*)?factura\s*[:.]?/i,
  /n[uú]mero\s*(?:de\s*)?factura\s*[:.]?/i,
  /factura\s*n[uú]m(?:ero)?\.?\s*[:.]?/i,
  /invoice\s*(?:no\.?|number|#)\s*[:.]?/i,
];

export interface ResultadoHeuristico {
  data: InvoiceData;
  warnings: string[];
}

// Cabeceras de tabla tipo "Nº Factura | Fecha emisión | Vencimiento": el valor va debajo, no al lado
const PARECE_ETIQUETA = /^(n[ºo°.]|n[uú]m|factura|fecha|vencimiento|vto|cliente|emisor|importe|total|base)\b/i;

const limpiaNif = (s: string) => s.replace(/-/g, '').toUpperCase();
const esDinero = (s: string) => ES_NUMERICA.test(s.trim());

function tokenFactura(s: string): string | null {
  const m = s.match(/[A-Z0-9][A-Z0-9/\-._]*\d[A-Z0-9/\-._]*/i);
  return m ? m[0].replace(/[.,;]+$/, '') : null;
}

/** Busca un rotulo y devuelve el texto que lo acompana: misma celda, celda contigua o linea siguiente. */
function valorDeEtiqueta(lineas: Line[], etiqueta: RegExp, excluir?: RegExp): string | null {
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i]!;
    for (let k = 0; k < linea.cells.length; k++) {
      const celda = linea.cells[k]!;
      if (excluir?.test(celda.text)) continue;
      const m = etiqueta.exec(celda.text);
      if (!m) continue;
      const resto = celda.text.slice(m.index + m[0].length).trim();
      if (resto) return resto;
      const vecina = linea.cells[k + 1];
      if (vecina && !PARECE_ETIQUETA.test(vecina.text)) return vecina.text;
      const debajo = lineas[i + 1]?.cells.find((c) => Math.abs(c.x - celda.x) < 40);
      if (debajo) return debajo.text;
    }
  }
  return null;
}

/** Lineas que hay bajo un rotulo, en su misma columna (por posicion x). */
function bloqueDebajo(lineas: Line[], i: number, celda: Cell, max = 5): string[] {
  const linea = lineas[i]!;
  const siguiente = linea.cells.find((c) => c.x > celda.x + 1);
  const x0 = celda.x - 6;
  const x1 = siguiente ? siguiente.x - 6 : Infinity;
  const out: string[] = [];
  let yPrevia = linea.y;
  for (let j = i + 1; j < lineas.length && j <= i + 16 && out.length < max; j++) {
    const texto = lineas[j]!.cells
      .filter((c) => c.x >= x0 && c.x < x1)
      .map((c) => c.text)
      .join(' ')
      .trim();
    if (!texto) continue; // fila de otra columna
    // un hueco de mas de ~1,5 lineas separa este bloque del siguiente
    if (yPrevia - lineas[j]!.y > 20 && out.length) break;
    if (ETIQ_EMISOR.test(texto) || ETIQ_CLIENTE.test(texto) || /^(fecha|vencimiento|descripci|concepto)/i.test(texto)) break;
    out.push(texto);
    yPrevia = lineas[j]!.y;
  }
  return out;
}

function parteDesdeBloque(bloque: string[]): Party | null {
  if (!bloque.length) return null;
  let taxId: string | null = null;
  const resto: string[] = [];
  for (const l of bloque) {
    const m = l.match(NIF);
    if (m && !taxId) taxId = limpiaNif(m[0]);
    const sinNif = l.replace(/\b(?:NIF|CIF|VAT|N\.?I\.?F\.?)\s*[:.]?\s*/gi, '').replace(NIF, '').replace(/[-–:\s]+$/, '').trim();
    if (sinNif) resto.push(sinNif);
  }
  const name = resto[0];
  if (!name) return null;
  const direccion = resto.slice(1).filter((l) => !/@|tel[ée]?f|^\+?\d[\d\s]{7,}$/i.test(l));
  return { name, taxId, address: direccion.length ? direccion.join(', ') : null };
}

function buscarPartes(lineas: Line[]): { supplier: Party | null; customer: Party | null } {
  let supplier: Party | null = null;
  let customer: Party | null = null;
  for (let i = 0; i < lineas.length && (!supplier || !customer); i++) {
    for (const celda of lineas[i]!.cells) {
      const texto = celda.text.replace(/[:]$/, '');
      if (!supplier && ETIQ_EMISOR.test(texto)) supplier = parteDesdeBloque(bloqueDebajo(lineas, i, celda));
      else if (!customer && ETIQ_CLIENTE.test(texto)) customer = parteDesdeBloque(bloqueDebajo(lineas, i, celda));
    }
  }
  if (supplier && customer) return { supplier, customer };

  // Sin rotulos: el primer NIF distinto es el emisor y el segundo el cliente.
  // El nombre suele estar en la misma celda o justo encima. Dos bloques en
  // paralelo pueden diferir unos puntos en altura por el tamano de letra, asi
  // que los NIF a menos de 30 pt entre si se agrupan y se ordenan de izquierda a derecha.
  const candidatos: { parte: Party; y: number; x: number }[] = [];
  const vistos = new Set<string>();
  for (let i = 0; i < lineas.length; i++) {
    for (const celda of lineas[i]!.cells) {
      const m = celda.text.match(NIF);
      if (!m) continue;
      const nif = limpiaNif(m[0]);
      if (vistos.has(nif)) continue;
      vistos.add(nif);
      const mismaCelda = celda.text.replace(/\b(?:NIF|CIF)\s*[:.]?\s*/gi, '').replace(NIF, '').trim();
      let encima: string | undefined;
      for (let j = i - 1; j >= 0 && j >= i - 4 && !encima; j--) {
        const c = lineas[j]!.cells.find((x) => Math.abs(x.x - celda.x) < 20 && !NIF.test(x.text));
        if (c && lineas[i]!.y - lineas[j]!.y < 40) encima = c.text;
      }
      const name = mismaCelda || encima;
      if (name && !/^factura$/i.test(name)) {
        candidatos.push({ parte: { name, taxId: nif, address: null }, y: lineas[i]!.page * 10000 - lineas[i]!.y, x: celda.x });
      }
    }
  }
  candidatos.sort((a, b) => a.y - b.y);
  const hallados: Party[] = [];
  for (let k = 0; k < candidatos.length; ) {
    let fin = k + 1;
    while (fin < candidatos.length && candidatos[fin]!.y - candidatos[fin - 1]!.y < 30) fin++;
    hallados.push(...candidatos.slice(k, fin).sort((a, b) => a.x - b.x).map((c) => c.parte));
    k = fin;
  }
  return { supplier: supplier ?? hallados[0] ?? null, customer: customer ?? hallados[1] ?? null };
}

function numeroFactura(lineas: Line[]): string | null {
  for (const re of NUM_FACTURA) {
    const v = valorDeEtiqueta(lineas, re);
    const t = v && tokenFactura(v);
    if (t) return t;
  }
  for (const l of lineas) {
    for (const c of l.cells) {
      const m = c.text.match(/^factura\s+([A-Z0-9][\w/.-]*\d[\w/.-]*)$/i);
      if (m) return m[1]!;
    }
  }
  return null;
}

function fechas(lineas: Line[]): { issue: string | null; due: string | null } {
  const venc = /(?:fecha\s*(?:de\s*)?(?:vencimiento|pago)|vencimiento|vto\.?)\s*[:.]?/i;
  const emis = /fecha\s*(?:de\s*)?(?:emisi[oó]n|factura|expedici[oó]n)\s*[:.]?/i;
  const generica = /fecha\s*[:.]?/i;
  const tomar = (re: RegExp, excluir?: RegExp) => {
    const v = valorDeEtiqueta(lineas, re, excluir);
    return v ? parseDate(v) : null;
  };
  return {
    issue: tomar(emis) ?? tomar(generica, /vencimiento|pago/i),
    due: tomar(venc),
  };
}

const COLUMNAS: [RegExp, keyof InvoiceLine][] = [
  [/cant|uds|unid|qty/i, 'quantity'],
  [/precio|p\.?\s*unit|unitario|tarifa/i, 'unitPrice'],
  [/dto|descuento/i, 'discountPct'],
  [/iva|tipo|%/i, 'taxRate'],
  [/importe|total|subtotal|neto/i, 'total'],
];

function campoDeColumna(nombre: string): keyof InvoiceLine | null {
  for (const [re, campo] of COLUMNAS) if (re.test(nombre)) return campo;
  return null;
}

const FIN_TABLA = /^(base\s*imponible|subtotal|total\b|suma\b|descuento\s*global|observaciones|forma\s*de\s*pago)/i;

function cabeceraTabla(linea: Line): boolean {
  const t = linea.cells.map((c) => c.text);
  return t.some((c) => /descripci|concepto|detalle|art[ií]culo/i.test(c)) && t.some((c) => /importe|total/i.test(c));
}

function lineasFactura(lineas: Line[]): { lines: InvoiceLine[]; fin: number } {
  const idx = lineas.findIndex(cabeceraTabla);
  if (idx < 0) return { lines: [], fin: 0 };
  const nombres = lineas[idx]!.cells.slice(1).map((c) => c.text);
  const campos = nombres.map(campoDeColumna);
  const out: InvoiceLine[] = [];
  let i = idx + 1;
  for (; i < lineas.length; i++) {
    const l = lineas[i]!;
    if (!l.cells.length) continue;
    if (FIN_TABLA.test(l.cells[0]!.text) || /base\s*imponible/i.test(l.text)) break;
    const celdas = l.cells.map((c) => c.text);
    const numeros: string[] = [];
    while (celdas.length > 1 && esDinero(celdas[celdas.length - 1]!)) numeros.unshift(celdas.pop()!);
    const descripcion = celdas.join(' ').trim();
    if (!numeros.length) {
      // linea sin cifras: continuacion de la descripcion anterior
      const previa = out[out.length - 1];
      if (previa) previa.description += ' ' + descripcion;
      continue;
    }
    const linea: InvoiceLine = { description: descripcion, quantity: null, unitPrice: null, discountPct: null, taxRate: null, total: null };
    if (numeros.length === campos.length && campos.every(Boolean)) {
      numeros.forEach((n, k) => {
        (linea as Record<string, unknown>)[campos[k]!] = parseAmount(n.replace('%', ''));
      });
    } else {
      linea.total = parseAmount(numeros[numeros.length - 1]!);
      if (numeros.length >= 3) {
        linea.quantity = parseAmount(numeros[0]!);
        linea.unitPrice = parseAmount(numeros[1]!);
      }
    }
    out.push(linea);
  }
  for (const l of out) l.description = l.description.replace(/\s+/g, ' ').trim();
  return { lines: out, fin: i };
}

function importesDeLinea(linea: Line): number[] {
  return (linea.text.match(DINERO) ?? []).map((m) => parseAmount(m)).filter((n): n is number => n != null);
}

function impuestos(lineas: Line[], desde: number): InvoiceTax[] {
  const out: InvoiceTax[] = [];
  // Formato tabla: cabecera "Base imponible | % IVA | Cuota" y filas sin rotulo
  const cab = lineas.findIndex((l, i) => i >= desde && /base\s*imponible/i.test(l.text) && /%|tipo/i.test(l.text) && /cuota/i.test(l.text));
  if (cab >= 0) {
    for (let i = cab + 1; i < lineas.length; i++) {
      const c = lineas[i]!.cells.map((x) => x.text);
      if (c.length < 3 || !c.every(esDinero)) break;
      const [base, tasa, cuota] = [parseAmount(c[0]!), parseAmount(c[1]!.replace('%', '')), parseAmount(c[2]!)];
      if (tasa == null) break;
      out.push({ type: 'IVA', rate: tasa, base, amount: cuota });
    }
    if (out.length) return out;
  }
  const re = /\b(IVA|IGIC|IPSI|IRPF|retenci[oó]n)\b[^%\d]*?(-?\d+(?:[.,]\d+)?)\s*%/i;
  for (let i = desde; i < lineas.length; i++) {
    const l = lineas[i]!;
    const m = l.text.match(re);
    if (!m) continue;
    const importes = importesDeLinea({ ...l, text: l.text.replace(m[0], ' ') });
    if (!importes.length) continue;
    const tipo = /retenci|irpf/i.test(m[1]!) ? 'IRPF' : m[1]!.toUpperCase();
    const amount = importes[importes.length - 1]!;
    out.push({
      type: tipo,
      rate: Math.abs(parseAmount(m[2]!) ?? 0),
      base: importes.length > 1 ? importes[0]! : null,
      amount: tipo === 'IRPF' && amount > 0 ? -amount : amount,
    });
  }
  return out;
}

function totales(lineas: Line[], desde: number): { subtotal: number | null; total: number | null } {
  let subtotal: number | null = null;
  let total: number | null = null;
  for (let i = desde; i < lineas.length; i++) {
    const l = lineas[i]!;
    const imp = importesDeLinea(l);
    if (!imp.length) continue;
    const ultimo = imp[imp.length - 1]!;
    if (/^(base\s*imponible|subtotal|total\s*bruto)/i.test(l.cells[0]?.text ?? '') && !/%/.test(l.text)) subtotal ??= ultimo;
    else if (/(total\s*(factura|a\s*pagar|general|con\s*iva|eur|a\s*abonar)|importe\s*total)/i.test(l.text) || /^total\b/i.test(l.cells[0]?.text ?? '')) {
      if (!/base|iva|impuesto/i.test(l.text)) total = ultimo;
    }
  }
  return { subtotal, total };
}

export function interpretarFactura(lineas: Line[]): ResultadoHeuristico {
  const data = emptyInvoice();
  const warnings: string[] = [];

  if (!lineas.length) {
    return { data, warnings: ['El PDF no contiene texto seleccionable, puede ser un escaneo. Hay que introducir los datos a mano.'] };
  }

  const { supplier, customer } = buscarPartes(lineas);
  data.supplier = supplier;
  data.customer = customer;
  data.number = numeroFactura(lineas);
  const f = fechas(lineas);
  data.issueDate = f.issue;
  data.dueDate = f.due;
  if (lineas.some((l) => /\bUSD\b|\$/.test(l.text)) && !lineas.some((l) => /€|EUR/.test(l.text))) data.currency = 'USD';

  const { lines, fin } = lineasFactura(lineas);
  data.lines = lines;
  data.taxes = impuestos(lineas, fin);
  const t = totales(lineas, fin);
  data.subtotal = t.subtotal;
  data.total = t.total;
  if (data.subtotal == null && data.taxes.length && data.taxes.every((x) => x.base != null && x.type !== 'IRPF')) {
    data.subtotal = redondear2(data.taxes.filter((x) => x.type !== 'IRPF').reduce((a, x) => a + x.base!, 0));
  }
  if (data.taxes.length) data.taxTotal = redondear2(data.taxes.reduce((a, x) => a + (x.amount ?? 0), 0));
  else if (data.total != null && data.subtotal != null) data.taxTotal = redondear2(data.total - data.subtotal);

  warnings.push(...avisos(data));
  return { data, warnings };
}

/** Comprobaciones de coherencia que tambien sirven para marcar facturas dudosas. */
export function avisos(d: InvoiceData): string[] {
  const w: string[] = [];
  if (!d.number) w.push('No se ha encontrado el número de factura.');
  if (!d.supplier) w.push('No se ha identificado al emisor.');
  if (!d.issueDate) w.push('No se ha encontrado la fecha de emisión.');
  if (d.total == null) w.push('No se ha encontrado el importe total.');
  if (!d.lines.length) w.push('No se han podido leer las líneas de detalle.');
  const sumaLineas = d.lines.length && d.lines.every((l) => l.total != null) ? redondear2(d.lines.reduce((a, l) => a + l.total!, 0)) : null;
  if (sumaLineas != null && d.subtotal != null && Math.abs(sumaLineas - d.subtotal) > 0.02) {
    w.push(`La suma de las líneas (${sumaLineas}) no coincide con la base imponible (${d.subtotal}).`);
  }
  if (d.subtotal != null && d.taxTotal != null && d.total != null && Math.abs(d.subtotal + d.taxTotal - d.total) > 0.02) {
    w.push(`Base imponible más impuestos (${redondear2(d.subtotal + d.taxTotal)}) no coincide con el total (${d.total}).`);
  }
  return w;
}
