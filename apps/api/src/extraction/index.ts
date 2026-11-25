import type { Config } from '../config.js';
import type { InvoiceData } from '../schema.js';
import { avisos, interpretarFactura } from './heuristic.js';
import { extraerConModelo } from './llm.js';
import { leerLineas, lineasATexto } from './pdf.js';

export interface Extraccion {
  data: InvoiceData;
  warnings: string[];
  method: 'heuristic' | 'llm';
}

export async function extraerFactura(
  pdf: Uint8Array,
  cfg: Pick<Config, 'anthropicKey' | 'anthropicModel'>,
  fetchFn: typeof fetch = fetch,
): Promise<Extraccion> {
  const lineas = await leerLineas(pdf);
  const reglas = interpretarFactura(lineas);
  if (!cfg.anthropicKey || !lineas.length) return { ...reglas, method: 'heuristic' };

  try {
    const data = await extraerConModelo(lineasATexto(lineas), { apiKey: cfg.anthropicKey, model: cfg.anthropicModel }, fetchFn);
    return { data, warnings: avisos(data), method: 'llm' };
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    return {
      ...reglas,
      warnings: [`No se pudo usar el modelo (${motivo}); se ha usado el lector por reglas.`, ...reglas.warnings],
      method: 'heuristic',
    };
  }
}
