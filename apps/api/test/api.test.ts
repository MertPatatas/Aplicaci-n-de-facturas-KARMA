import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { entornoDePrueba, muestra } from './helpers.js';

const NOW = new Date('2026-11-22T10:00:00Z');

function nuevaApp() {
  const { cfg, db } = entornoDePrueba();
  return { app: createApp({ db, cfg, now: () => NOW }), cfg };
}

const subir = (app: ReturnType<typeof createApp>, buf: Buffer, nombre: string, token = 'token-de-prueba') =>
  request(app)
    .post('/api/ingest')
    .set('x-ingest-token', token)
    .field('messageId', '<abc@correo.test>')
    .field('from', 'facturas@proveedor.test')
    .field('subject', 'Factura de octubre')
    .field('receivedAt', '2026-11-22T08:00:00Z')
    .attach('file', buf, { filename: nombre, contentType: 'application/pdf' });

describe('API', () => {
  it('rechaza la ingesta sin token', async () => {
    const { app } = nuevaApp();
    const r = await subir(app, muestra('A_suministros_iberricos.pdf'), 'a.pdf', 'otro');
    expect(r.status).toBe(401);
  });

  it('solo acepta PDF aunque el nombre acabe en .pdf', async () => {
    const { app } = nuevaApp();
    const r = await subir(app, Buffer.from('esto es un texto, no un pdf'), 'falso.pdf');
    expect(r.status).toBe(415);
    expect((await request(app).get('/api/invoices')).body).toEqual([]);
  });

  it('exige el campo file', async () => {
    const { app } = nuevaApp();
    const r = await request(app).post('/api/ingest').set('x-ingest-token', 'token-de-prueba').field('from', 'x');
    expect(r.status).toBe(400);
  });

  it('ingesta, detecta duplicados y lista', async () => {
    const { app } = nuevaApp();
    const a = await subir(app, muestra('A_suministros_iberricos.pdf'), 'a.pdf');
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ duplicate: false, method: 'heuristic', warnings: [] });

    const otra = await subir(app, muestra('A_suministros_iberricos.pdf'), 'copia.pdf');
    expect(otra.status).toBe(200);
    expect(otra.body).toEqual({ invoiceId: a.body.invoiceId, duplicate: true, warnings: [] });

    await subir(app, muestra('B_graficas_levante.pdf'), 'b.pdf');
    const lista = await request(app).get('/api/invoices');
    expect(lista.body).toHaveLength(2);
    expect(lista.body[0]).toMatchObject({ status: 'pending_review', warningCount: 0 });

    const filtrada = await request(app).get('/api/invoices').query({ q: 'GRAFICAS' });
    expect(filtrada.body.map((f: { number: string }) => f.number)).toEqual(['2026/0087']);
    const porImporte = await request(app).get('/api/invoices').query({ minTotal: 300 });
    expect(porImporte.body).toHaveLength(1);
  });

  it('un PDF que no es factura se guarda para revision con avisos', async () => {
    const { app } = nuevaApp();
    const r = await subir(app, muestra('E_no_es_factura.pdf'), 'carta.pdf');
    expect(r.status).toBe(201);
    expect(r.body.warnings.length).toBeGreaterThan(3);
    const detalle = await request(app).get(`/api/invoices/${r.body.invoiceId}`);
    expect(detalle.body).toMatchObject({ status: 'pending_review', number: null, total: null });
  });

  it('detalle con cabecera, lineas, impuestos, origen y PDF', async () => {
    const { app } = nuevaApp();
    const { body } = await subir(app, muestra('B_graficas_levante.pdf'), 'b.pdf');
    const d = (await request(app).get(`/api/invoices/${body.invoiceId}`)).body;
    expect(d.supplier).toEqual({ name: 'Gráficas Levante S.A.', taxId: 'A46093827', address: null });
    expect(d.lines).toHaveLength(3);
    expect(d.taxes).toHaveLength(2);
    expect(d.source).toEqual({ filename: 'b.pdf', emailFrom: 'facturas@proveedor.test', emailSubject: 'Factura de octubre' });
    expect(d.receivedAt).toBe('2026-11-22T08:00:00.000Z');

    const pdf = await request(app).get(`/api/invoices/${body.invoiceId}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.length).toBe(muestra('B_graficas_levante.pdf').length);
    expect((await request(app).get('/api/invoices/999')).status).toBe(404);
  });

  it('se puede editar cualquier dato y validar', async () => {
    const { app } = nuevaApp();
    const { body } = await subir(app, muestra('A_suministros_iberricos.pdf'), 'a.pdf');
    const url = `/api/invoices/${body.invoiceId}`;
    const original = (await request(app).get(url)).body;

    const editada = {
      ...original,
      number: 'SI-2026-0412-R',
      dueDate: '2026-12-31',
      total: 300,
      supplier: { ...original.supplier, name: 'Suministros Ibéricos, S.L.' },
      lines: [...original.lines, { description: 'Portes', quantity: 1, unitPrice: 5, discountPct: null, taxRate: null, total: 5 }],
      taxes: [{ type: 'IVA', rate: 21, base: 228.83, amount: 48.05 }],
      status: 'validated',
    };
    const r = await request(app).put(url).send(editada);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ number: 'SI-2026-0412-R', dueDate: '2026-12-31', total: 300, status: 'validated' });
    expect(r.body.supplier.name).toBe('Suministros Ibéricos, S.L.');
    expect(r.body.supplier.taxId).toBe('B46218353');
    expect(r.body.lines).toHaveLength(4);
    expect(r.body.validatedAt).not.toBeNull();

    const reabierta = await request(app).post(`${url}/status`).send({ status: 'pending_review' });
    expect(reabierta.body).toMatchObject({ status: 'pending_review', validatedAt: null });
  });

  it('valida los datos recibidos al editar', async () => {
    const { app } = nuevaApp();
    const { body } = await subir(app, muestra('A_suministros_iberricos.pdf'), 'a.pdf');
    const url = `/api/invoices/${body.invoiceId}`;
    const original = (await request(app).get(url)).body;
    const r = await request(app).put(url).send({ ...original, issueDate: '27/10/2026' });
    expect(r.status).toBe(400);
    expect(r.body.detalles[0]).toContain('issueDate');
    expect((await request(app).post(`${url}/status`).send({ status: 'otra' })).status).toBe(400);
    expect((await request(app).put('/api/invoices/999').send(original)).status).toBe(404);
  });

  it('el asistente contesta con datos de la base', async () => {
    const { app } = nuevaApp();
    await subir(app, muestra('A_suministros_iberricos.pdf'), 'a.pdf');
    const r = await request(app).post('/api/assistant').send({ message: '¿Cuántas facturas han llegado hoy?' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ intent: 'contar', mode: 'reglas' });
    expect(r.body.answer).toContain('Hay 1 factura hoy');
    expect((await request(app).post('/api/assistant').send({ message: '' })).status).toBe(400);
  });
});
