import type { Config } from '../config.js';
import type { DB } from '../db.js';
import { responderPorReglas, type RespuestaAsistente } from './interpreter.js';
import { responderConModelo } from './llm.js';

export async function preguntar(
  pregunta: string,
  deps: { db: DB; cfg: Config; now?: Date; fetchFn?: typeof fetch },
): Promise<RespuestaAsistente> {
  const ctx = { db: deps.db, now: deps.now ?? new Date(), timeZone: deps.cfg.timeZone };
  if (deps.cfg.anthropicKey) {
    try {
      return await responderConModelo(pregunta, ctx, deps.cfg, deps.fetchFn);
    } catch (err) {
      console.warn('Asistente: fallo el modelo, se usa el interprete por reglas:', err instanceof Error ? err.message : err);
    }
  }
  return responderPorReglas(pregunta, ctx);
}
