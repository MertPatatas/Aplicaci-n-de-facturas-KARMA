import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { ZodError, z } from 'zod';
import { preguntar } from './assistant/index.js';
import type { Config } from './config.js';
import type { DB } from './db.js';
import { ErrorIngesta, ingestarPdf } from './ingest.js';
import { actualizarFactura, cambiarEstado, listarFacturas, obtenerFactura, rutaPdf } from './repo.js';
import { STATUSES, invoiceUpdateSchema } from './schema.js';

export interface Deps {
  db: DB;
  cfg: Config;
  /** Se inyecta en los tests para no llamar a la API real del modelo */
  fetchFn?: typeof fetch;
  now?: () => Date;
}

const filtrosSchema = z.object({
  status: z.enum(STATUSES).optional(),
  q: z.string().trim().min(1).optional(),
  supplier: z.string().trim().min(1).optional(),
  minTotal: z.coerce.number().optional(),
  maxTotal: z.coerce.number().optional(),
});

export function createApp({ db, cfg, fetchFn, now = () => new Date() }: Deps) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, extractor: cfg.anthropicKey ? 'modelo' : 'reglas' });
  });

  // Endpoint que llama n8n: un PDF por peticion, con los datos del correo
  app.post(
    '/api/ingest',
    (req, res, next) => {
      if (req.header('x-ingest-token') !== cfg.ingestToken) {
        res.status(401).json({ error: 'Token de ingesta no válido' });
        return;
      }
      next();
    },
    subida.single('file'),
    async (req, res) => {
      if (!req.file) throw new ErrorIngesta(400, 'Falta el campo "file" con el PDF');
      const b = req.body as Record<string, string | undefined>;
      const r = await ingestarPdf(
        { db, cfg, fetchFn },
        {
          buffer: req.file.buffer,
          filename: req.file.originalname,
          mimetype: req.file.mimetype,
          messageId: b.messageId,
          from: b.from,
          subject: b.subject,
          receivedAt: b.receivedAt,
        },
      );
      res.status(r.duplicate ? 200 : 201).json(r);
    },
  );

  app.get('/api/invoices', (req, res) => {
    res.json(listarFacturas(db, filtrosSchema.parse(req.query)));
  });

  app.get('/api/invoices/:id', (req, res) => {
    const factura = obtenerFactura(db, Number(req.params.id));
    if (!factura) {
      res.status(404).json({ error: 'Factura no encontrada' });
      return;
    }
    res.json(factura);
  });

  app.put('/api/invoices/:id', (req, res) => {
    const id = Number(req.params.id);
    const { status, ...datos } = invoiceUpdateSchema.parse(req.body);
    if (!actualizarFactura(db, id, datos, status)) {
      res.status(404).json({ error: 'Factura no encontrada' });
      return;
    }
    res.json(obtenerFactura(db, id));
  });

  app.post('/api/invoices/:id/status', (req, res) => {
    const id = Number(req.params.id);
    const { status } = z.object({ status: z.enum(STATUSES) }).parse(req.body);
    if (!cambiarEstado(db, id, status)) {
      res.status(404).json({ error: 'Factura no encontrada' });
      return;
    }
    res.json(obtenerFactura(db, id));
  });

  app.get('/api/invoices/:id/pdf', (req, res) => {
    const doc = rutaPdf(db, Number(req.params.id));
    if (!doc || !fs.existsSync(doc.path)) {
      res.status(404).json({ error: 'PDF no encontrado' });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.filename)}"`);
    fs.createReadStream(doc.path).pipe(res);
  });

  app.post('/api/assistant', async (req, res) => {
    const { message } = z.object({ message: z.string().trim().min(1).max(500) }).parse(req.body);
    res.json(await preguntar(message, { db, cfg, now: now(), fetchFn }));
  });

  // En produccion el propio servidor sirve la interfaz compilada
  if (cfg.webDir && fs.existsSync(cfg.webDir)) {
    app.use(express.static(cfg.webDir));
    app.get('/{*ruta}', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(cfg.webDir!, 'index.html'));
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'Datos no válidos', detalles: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    } else if (err instanceof ErrorIngesta) {
      res.status(err.status).json({ error: err.message });
    } else if (err instanceof multer.MulterError) {
      res.status(400).json({ error: err.message });
    } else {
      console.error(err);
      res.status(500).json({ error: 'Error interno' });
    }
  });

  return app;
}
