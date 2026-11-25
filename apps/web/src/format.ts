export const eur = (n: number | null | undefined, moneda = 'EUR'): string =>
  n == null ? '' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: moneda }).format(n);

export const fecha = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export const fechaHora = (iso: string): string =>
  new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
