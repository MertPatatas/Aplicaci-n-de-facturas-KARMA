import { describe, expect, it } from 'vitest';
import { responderConModelo } from '../src/assistant/llm.js';
import { extraerFactura } from '../src/extraction/index.js';
import { ingestarPdf } from '../src/ingest.js';
import { entornoDePrueba, muestra } from './helpers.js';

const respuesta = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status });

describe('extraccion con modelo (fetch simulado)', () => {
  const cfg = { anthropicKey: 'clave', anthropicModel: 'modelo' };

  it('usa el JSON del modelo y valida su forma', async () => {
    const json = { supplier: { name: 'Proveedor SL', taxId: 'B12345678' }, number: 'F-1', issueDate: '2026-11-01', total: 121, subtotal: 100, taxTotal: 21, lines: [{ description: 'Servicio', total: 100 }], taxes: [{ rate: 21, amount: 21 }] };
    let peticion: { headers: Record<string, string>; body: string } | undefined;
    const fetchFn = (async (_url: string, init: RequestInit) => {
      peticion = { headers: init.headers as Record<string, string>, body: init.body as string };
      return respuesta({ content: [{ type: 'text', text: 'Aqui esta:\n' + JSON.stringify(json) }] });
    }) as unknown as typeof fetch;

    const r = await extraerFactura(new Uint8Array(muestra('A_suministros_iberricos.pdf')), cfg, fetchFn);
    expect(r.method).toBe('llm');
    expect(r.data).toMatchObject({ number: 'F-1', total: 121, currency: 'EUR' });
    expect(r.data.lines[0]).toMatchObject({ description: 'Servicio', quantity: null, total: 100 });
    expect(r.warnings).toEqual([]);
    expect(peticion!.headers['x-api-key']).toBe('clave');
    expect(JSON.parse(peticion!.body).messages[0].content).toContain('Suministros Ibéricos S.L.');
  });

  it('si el modelo falla o devuelve basura, cae al lector por reglas con un aviso', async () => {
    const caido = (async () => respuesta({ error: 'sobrecargado' }, 529)) as unknown as typeof fetch;
    const r1 = await extraerFactura(new Uint8Array(muestra('A_suministros_iberricos.pdf')), cfg, caido);
    expect(r1.method).toBe('heuristic');
    expect(r1.warnings[0]).toMatch(/No se pudo usar el modelo/);
    expect(r1.data.number).toBe('SI-2026-0412');

    const basura = (async () => respuesta({ content: [{ type: 'text', text: 'no puedo ayudar' }] })) as unknown as typeof fetch;
    const r2 = await extraerFactura(new Uint8Array(muestra('A_suministros_iberricos.pdf')), cfg, basura);
    expect(r2.method).toBe('heuristic');

    const malFormado = (async () => respuesta({ content: [{ type: 'text', text: '{"issueDate":"ayer"}' }] })) as unknown as typeof fetch;
    expect((await extraerFactura(new Uint8Array(muestra('A_suministros_iberricos.pdf')), cfg, malFormado)).method).toBe('heuristic');
  });
});

describe('asistente con modelo (fetch simulado)', () => {
  it('ejecuta la herramienta que pide el modelo y devuelve su respuesta final', async () => {
    const { cfg, db } = entornoDePrueba({ anthropicKey: 'clave' });
    await ingestarPdf({ db, cfg }, { buffer: muestra('A_suministros_iberricos.pdf'), filename: 'a.pdf', receivedAt: '2026-11-22T08:00:00Z' });

    const cuerpos: { messages: { role: string; content: unknown }[] }[] = [];
    let vuelta = 0;
    const fetchFn = (async (_u: string, init: RequestInit) => {
      cuerpos.push(JSON.parse(init.body as string));
      vuelta++;
      if (vuelta === 1) {
        return respuesta({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'listar_facturas', input: { periodo: 'today' } }] });
      }
      return respuesta({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hoy ha llegado 1 factura, de Suministros Ibéricos.' }] });
    }) as unknown as typeof fetch;

    const ctx = { db, now: new Date('2026-11-22T10:00:00Z'), timeZone: 'Europe/Madrid' };
    const r = await responderConModelo('¿Qué ha llegado hoy?', ctx, cfg, fetchFn);
    expect(r).toMatchObject({ mode: 'modelo', answer: 'Hoy ha llegado 1 factura, de Suministros Ibéricos.' });
    expect(r.invoices).toHaveLength(1);

    // la segunda llamada lleva el resultado real de la herramienta
    const segundo = cuerpos[1]!.messages.at(-1)!;
    expect(segundo.role).toBe('user');
    const resultado = (segundo.content as { type: string; content: string }[])[0]!;
    expect(resultado.type).toBe('tool_result');
    expect(JSON.parse(resultado.content)[0]).toMatchObject({ number: 'SI-2026-0412', total: 276.88 });
  });
});
