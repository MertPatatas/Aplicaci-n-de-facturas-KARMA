import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config.js';
import type { DB } from './db.js';
import { extraerFactura } from './extraction/index.js';
import { esPdf } from './extraction/pdf.js';
import { buscarDocumentoPorHash, crearFactura } from './repo.js';

export class ErrorIngesta extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface EntradaPdf {
  buffer: Buffer;
  filename: string;
  mimetype?: string;
  messageId?: string | null;
  from?: string | null;
  subject?: string | null;
  receivedAt?: string | null;
}

export interface ResultadoIngesta {
  invoiceId: number | null;
  duplicate: boolean;
  method?: 'heuristic' | 'llm';
  warnings: string[];
}

export async function ingestarPdf(
  ctx: { db: DB; cfg: Config; fetchFn?: typeof fetch },
  e: EntradaPdf,
): Promise<ResultadoIngesta> {
  // Solo se aceptan PDF. Se comprueba el contenido y no solo la extension,
  // porque el correo puede traer cualquier cosa con nombre .pdf.
  if (!esPdf(e.buffer)) {
    throw new ErrorIngesta(415, 'El adjunto no es un PDF válido');
  }
  const sha256 = crypto.createHash('sha256').update(e.buffer).digest('hex');
  const previo = buscarDocumentoPorHash(ctx.db, sha256);
  if (previo) return { invoiceId: previo.invoiceId, duplicate: true, warnings: [] };

  let extraccion;
  try {
    extraccion = await extraerFactura(new Uint8Array(e.buffer), ctx.cfg, ctx.fetchFn);
  } catch (err) {
    throw new ErrorIngesta(422, `No se pudo leer el PDF: ${err instanceof Error ? err.message : String(err)}`);
  }

  fs.mkdirSync(ctx.cfg.pdfDir, { recursive: true });
  const stored = path.join(ctx.cfg.pdfDir, `${sha256}.pdf`);
  fs.writeFileSync(stored, e.buffer);

  const recibida = e.receivedAt && !Number.isNaN(Date.parse(e.receivedAt)) ? new Date(e.receivedAt).toISOString() : new Date().toISOString();
  const invoiceId = crearFactura(
    ctx.db,
    {
      filename: path.basename(e.filename || 'factura.pdf'),
      sha256,
      storedPath: stored,
      sizeBytes: e.buffer.length,
      emailMessageId: e.messageId || null,
      emailFrom: e.from || null,
      emailSubject: e.subject || null,
      receivedAt: recibida,
    },
    extraccion.data,
    { method: extraccion.method, warnings: extraccion.warnings },
  );
  return { invoiceId, duplicate: false, method: extraccion.method, warnings: extraccion.warnings };
}
