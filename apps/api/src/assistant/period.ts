export type Periodo = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'all';

export const ETIQUETA_PERIODO: Record<Periodo, string> = {
  today: 'hoy',
  yesterday: 'ayer',
  this_week: 'esta semana',
  this_month: 'este mes',
  all: 'en total',
};

interface Partes {
  y: number;
  m: number;
  d: number;
  dow: number; // 1 = lunes ... 7 = domingo
}

function partesLocales(instante: number, tz: string): Partes {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(instante).map((x) => [x.type, x.value]));
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday!) + 1;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), dow };
}

function desfase(instante: number, tz: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  const p = Object.fromEntries(f.formatToParts(instante).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(instante / 1000) * 1000;
}

/** Instante UTC en el que empieza el dia (y, m, d) en la zona horaria tz. */
function inicioDeDia(y: number, m: number, d: number, tz: string): number {
  const nominal = Date.UTC(y, m - 1, d);
  let t = nominal - desfase(nominal, tz);
  t = nominal - desfase(t, tz); // segunda pasada por si hay cambio de hora ese dia
  return t;
}

const sumarDias = (y: number, m: number, d: number, n: number) => {
  const f = new Date(Date.UTC(y, m - 1, d + n));
  return { y: f.getUTCFullYear(), m: f.getUTCMonth() + 1, d: f.getUTCDate() };
};

/** Rango [from, to) en ISO UTC. Para 'all' no hay limites. */
export function rangoPeriodo(periodo: Periodo, now: Date, tz: string): { from?: string; to?: string } {
  if (periodo === 'all') return {};
  const hoy = partesLocales(now.getTime(), tz);
  let ini: { y: number; m: number; d: number };
  let fin: { y: number; m: number; d: number };
  if (periodo === 'today') {
    ini = hoy;
    fin = sumarDias(hoy.y, hoy.m, hoy.d, 1);
  } else if (periodo === 'yesterday') {
    ini = sumarDias(hoy.y, hoy.m, hoy.d, -1);
    fin = hoy;
  } else if (periodo === 'this_week') {
    ini = sumarDias(hoy.y, hoy.m, hoy.d, -(hoy.dow - 1));
    fin = sumarDias(ini.y, ini.m, ini.d, 7);
  } else {
    ini = { y: hoy.y, m: hoy.m, d: 1 };
    fin = hoy.m === 12 ? { y: hoy.y + 1, m: 1, d: 1 } : { y: hoy.y, m: hoy.m + 1, d: 1 };
  }
  return {
    from: new Date(inicioDeDia(ini.y, ini.m, ini.d, tz)).toISOString(),
    to: new Date(inicioDeDia(fin.y, fin.m, fin.d, tz)).toISOString(),
  };
}
