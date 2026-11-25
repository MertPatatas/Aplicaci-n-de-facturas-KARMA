const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

export const aCentimos = (euros: number | null | undefined): number | null =>
  euros == null ? null : Math.round(euros * 100);

export const deCentimos = (cents: number | null | undefined): number | null =>
  cents == null ? null : cents / 100;

export const redondear2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Convierte "1.234,56 €", "1234.56", "-12,5" o "(45,00)" en numero.
 * Si hay coma y punto, el ultimo de los dos es el separador decimal.
 */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[€$£]|EUR|eur/g, '').replace(/\s+/g, '').trim();
  if (!s) return null;
  let negativo = false;
  if (/^\(.*\)$/.test(s)) {
    negativo = true;
    s = s.slice(1, -1);
  }
  if (/^[-−–]/.test(s)) {
    negativo = !negativo;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s)) return null;
  const coma = s.lastIndexOf(',');
  const punto = s.lastIndexOf('.');
  if (coma >= 0 && punto >= 0) {
    s = coma > punto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (coma >= 0) {
    s = s.replace(',', '.');
  } else if (punto >= 0) {
    // "1.234" con grupos de tres cifras es un millar, "12.50" es un decimal
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const fecha = new Date(Date.UTC(y, m - 1, d));
  if (fecha.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Admite 14/10/2026, 14-10-26, 2026-10-14 y "14 de octubre de 2026". */
export function parseDate(raw: string): string | null {
  const s = raw.toLowerCase();
  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})\b/);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return iso(y, Number(m[2]), Number(m[1]));
  }
  m = s.match(/\b(\d{1,2})\s+de\s+([a-záéíóú]+)\s+(?:de\s+)?(\d{4})\b/);
  if (m && MESES[m[2]!]) return iso(Number(m[3]), MESES[m[2]!]!, Number(m[1]));
  return null;
}

export const eur = (n: number): string =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);

/** Minusculas y sin acentos, para comparar nombres y preguntas. */
export const normalizar = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
