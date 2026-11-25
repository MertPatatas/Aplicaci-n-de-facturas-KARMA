import { describe, expect, it } from 'vitest';
import { normalizar, parseAmount, parseDate } from '../src/util.js';

describe('parseAmount', () => {
  it.each([
    ['1.234,56 €', 1234.56],
    ['1234.56', 1234.56],
    ['24,50 €', 24.5],
    ['-297,00 €', -297],
    ['(45,00)', -45],
    ['1.980', 1980],
    ['12.50', 12.5],
    ['1,234.50', 1234.5],
    ['0 ', 0],
  ])('%s', (entrada, esperado) => {
    expect(parseAmount(entrada)).toBe(esperado);
  });

  it('devuelve null si no es un numero', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
});

describe('parseDate', () => {
  it.each([
    ['27/10/2026', '2026-10-27'],
    ['3-11-26', '2026-11-03'],
    ['2026-10-14', '2026-10-14'],
    ['14 de octubre de 2026', '2026-10-14'],
    ['1 de enero 2027', '2027-01-01'],
    ['31/02/2026', null],
  ])('%s', (entrada, esperado) => {
    expect(parseDate(entrada)).toBe(esperado);
  });
});

it('normalizar quita acentos y mayusculas', () => {
  expect(normalizar('Gráficas LEVANTE')).toBe('graficas levante');
});
