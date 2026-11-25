import { describe, expect, it } from 'vitest';
import { rangoPeriodo } from '../src/assistant/period.js';

const TZ = 'Europe/Madrid';

describe('rangoPeriodo', () => {
  it('hoy en horario de verano (UTC+2)', () => {
    const r = rangoPeriodo('today', new Date('2026-10-22T10:30:00Z'), TZ);
    expect(r).toEqual({ from: '2026-10-21T22:00:00.000Z', to: '2026-10-22T22:00:00.000Z' });
  });

  it('el dia del cambio de hora dura 25 horas', () => {
    const r = rangoPeriodo('today', new Date('2026-10-25T12:00:00Z'), TZ);
    expect(r).toEqual({ from: '2026-10-24T22:00:00.000Z', to: '2026-10-25T23:00:00.000Z' });
  });

  it('cerca de medianoche cuenta el dia local, no el UTC', () => {
    // 23:30 UTC del 22 ya es 00:30 del 23 en Madrid (invierno: UTC+1)
    const r = rangoPeriodo('today', new Date('2026-11-22T23:30:00Z'), TZ);
    expect(r.from).toBe('2026-11-22T23:00:00.000Z');
  });

  it('la semana empieza el lunes', () => {
    // 22/11/2026 es domingo: la semana va del 16 al 23
    const r = rangoPeriodo('this_week', new Date('2026-11-22T12:00:00Z'), TZ);
    expect(r).toEqual({ from: '2026-11-15T23:00:00.000Z', to: '2026-11-22T23:00:00.000Z' });
  });

  it('el mes y diciembre pasan de ano', () => {
    const r = rangoPeriodo('this_month', new Date('2026-12-10T12:00:00Z'), TZ);
    expect(r).toEqual({ from: '2026-11-30T23:00:00.000Z', to: '2026-12-31T23:00:00.000Z' });
  });

  it('ayer y todo', () => {
    expect(rangoPeriodo('yesterday', new Date('2026-11-22T12:00:00Z'), TZ)).toEqual({
      from: '2026-11-20T23:00:00.000Z',
      to: '2026-11-21T23:00:00.000Z',
    });
    expect(rangoPeriodo('all', new Date(), TZ)).toEqual({});
  });
});
