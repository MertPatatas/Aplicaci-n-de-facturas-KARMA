import type { DB } from './db.js';
import { transaction } from './db.js';
import type { InvoiceData, Party, Status } from './schema.js';
import { aCentimos, deCentimos, normalizar } from './util.js';

export interface InvoiceFilters {
  status?: Status;
  /** Excluye un estado (las estadisticas del asistente ignoran las rechazadas) */
  excludeStatus?: Status;
  q?: string;
  supplier?: string;
  minTotal?: number;
  maxTotal?: number;
  /** Rango de llegada, en ISO UTC: [receivedFrom, receivedTo) */
  receivedFrom?: string;
  receivedTo?: string;
}

export interface InvoiceSummary {
  id: number;
  number: string | null;
  supplierName: string | null;
  issueDate: string | null;
  total: number | null;
  currency: string;
  status: Status;
  receivedAt: string;
  warningCount: number;
}

export interface InvoiceDetail extends InvoiceData {
  id: number;
  status: Status;
  extractionMethod: 'heuristic' | 'llm';
  warnings: string[];
  receivedAt: string;
  validatedAt: string | null;
  updatedAt: string;
  source: { filename: string; emailFrom: string | null; emailSubject: string | null };
}

type Row = Record<string, string | number | null>;

function upsertParty(db: DB, table: 'suppliers' | 'customers', p: Party | null): number | null {
  if (!p) return null;
  if (p.taxId) {
    const hallado = db.prepare(`SELECT id FROM ${table} WHERE tax_id = ?`).get(p.taxId) as { id: number } | undefined;
    if (hallado) {
      db.prepare(`UPDATE ${table} SET name = ?, address = COALESCE(?, address) WHERE id = ?`).run(p.name, p.address, hallado.id);
      return hallado.id;
    }
  } else {
    const hallado = db.prepare(`SELECT id FROM ${table} WHERE tax_id IS NULL AND lower(name) = lower(?)`).get(p.name) as { id: number } | undefined;
    if (hallado) return hallado.id;
  }
  const r = db.prepare(`INSERT INTO ${table} (name, tax_id, address) VALUES (?, ?, ?)`).run(p.name, p.taxId, p.address);
  return Number(r.lastInsertRowid);
}

function guardarDetalle(db: DB, invoiceId: number, d: InvoiceData) {
  db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(invoiceId);
  db.prepare('DELETE FROM invoice_taxes WHERE invoice_id = ?').run(invoiceId);
  const insLinea = db.prepare(
    `INSERT INTO invoice_lines (invoice_id, position, description, quantity, unit_price, discount_pct, tax_rate, line_total_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  d.lines.forEach((l, i) => insLinea.run(invoiceId, i + 1, l.description, l.quantity, l.unitPrice, l.discountPct, l.taxRate, aCentimos(l.total)));
  const insImp = db.prepare('INSERT INTO invoice_taxes (invoice_id, tax_type, rate, base_cents, amount_cents) VALUES (?, ?, ?, ?, ?)');
  for (const t of d.taxes) insImp.run(invoiceId, t.type, t.rate, aCentimos(t.base), aCentimos(t.amount));
}

export interface NuevoDocumento {
  filename: string;
  sha256: string;
  storedPath: string;
  sizeBytes: number;
  emailMessageId: string | null;
  emailFrom: string | null;
  emailSubject: string | null;
  receivedAt: string;
}

export function buscarDocumentoPorHash(db: DB, sha256: string): { invoiceId: number | null } | null {
  const r = db
    .prepare('SELECT i.id AS invoice_id FROM source_documents s LEFT JOIN invoices i ON i.source_document_id = s.id WHERE s.sha256 = ?')
    .get(sha256) as { invoice_id: number | null } | undefined;
  return r ? { invoiceId: r.invoice_id } : null;
}

export function crearFactura(
  db: DB,
  doc: NuevoDocumento,
  d: InvoiceData,
  meta: { method: 'heuristic' | 'llm'; warnings: string[] },
): number {
  return transaction(db, () => {
    const docId = Number(
      db
        .prepare(
          `INSERT INTO source_documents (filename, sha256, stored_path, size_bytes, email_message_id, email_from, email_subject, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(doc.filename, doc.sha256, doc.storedPath, doc.sizeBytes, doc.emailMessageId, doc.emailFrom, doc.emailSubject, doc.receivedAt).lastInsertRowid,
    );
    const id = Number(
      db
        .prepare(
          `INSERT INTO invoices (source_document_id, supplier_id, customer_id, number, issue_date, due_date, currency,
             subtotal_cents, tax_total_cents, total_cents, extraction_method, warnings, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          docId,
          upsertParty(db, 'suppliers', d.supplier),
          upsertParty(db, 'customers', d.customer),
          d.number,
          d.issueDate,
          d.dueDate,
          d.currency,
          aCentimos(d.subtotal),
          aCentimos(d.taxTotal),
          aCentimos(d.total),
          meta.method,
          JSON.stringify(meta.warnings),
          d.notes,
        ).lastInsertRowid,
    );
    guardarDetalle(db, id, d);
    return id;
  });
}

export function actualizarFactura(db: DB, id: number, d: InvoiceData, status?: Status): boolean {
  return transaction(db, () => {
    const existe = db.prepare('SELECT status FROM invoices WHERE id = ?').get(id) as { status: Status } | undefined;
    if (!existe) return false;
    const nuevoEstado = status ?? existe.status;
    db.prepare(
      `UPDATE invoices SET supplier_id = ?, customer_id = ?, number = ?, issue_date = ?, due_date = ?, currency = ?,
         subtotal_cents = ?, tax_total_cents = ?, total_cents = ?, notes = ?, status = ?,
         validated_at = CASE WHEN ? = 'validated' THEN COALESCE(validated_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE NULL END,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
    ).run(
      upsertParty(db, 'suppliers', d.supplier),
      upsertParty(db, 'customers', d.customer),
      d.number,
      d.issueDate,
      d.dueDate,
      d.currency,
      aCentimos(d.subtotal),
      aCentimos(d.taxTotal),
      aCentimos(d.total),
      d.notes,
      nuevoEstado,
      nuevoEstado,
      id,
    );
    guardarDetalle(db, id, d);
    return true;
  });
}

export function cambiarEstado(db: DB, id: number, status: Status): boolean {
  const r = db
    .prepare(
      `UPDATE invoices SET status = ?,
         validated_at = CASE WHEN ? = 'validated' THEN COALESCE(validated_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE NULL END,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    )
    .run(status, status, id);
  return Number(r.changes) > 0;
}

const SELECT_RESUMEN = `
  SELECT i.id, i.number, s.name AS supplier_name, i.issue_date, i.total_cents, i.currency, i.status,
         d.received_at, i.warnings
  FROM invoices i
  JOIN source_documents d ON d.id = i.source_document_id
  LEFT JOIN suppliers s ON s.id = i.supplier_id`;

export function condicionesFiltro(f: InvoiceFilters): { where: string; params: (string | number)[] } {
  const cond: string[] = [];
  const params: (string | number)[] = [];
  if (f.status) { cond.push('i.status = ?'); params.push(f.status); }
  if (f.excludeStatus) { cond.push('i.status != ?'); params.push(f.excludeStatus); }
  if (f.q) {
    cond.push('(norm(s.name) LIKE ? OR norm(i.number) LIKE ?)');
    const like = `%${normalizar(f.q)}%`;
    params.push(like, like);
  }
  if (f.supplier) { cond.push('norm(s.name) LIKE ?'); params.push(`%${normalizar(f.supplier)}%`); }
  if (f.minTotal != null) { cond.push('i.total_cents > ?'); params.push(Math.round(f.minTotal * 100)); }
  if (f.maxTotal != null) { cond.push('i.total_cents < ?'); params.push(Math.round(f.maxTotal * 100)); }
  if (f.receivedFrom) { cond.push('d.received_at >= ?'); params.push(f.receivedFrom); }
  if (f.receivedTo) { cond.push('d.received_at < ?'); params.push(f.receivedTo); }
  return { where: cond.length ? 'WHERE ' + cond.join(' AND ') : '', params };
}

function aResumen(r: Row): InvoiceSummary {
  return {
    id: r.id as number,
    number: r.number as string | null,
    supplierName: r.supplier_name as string | null,
    issueDate: r.issue_date as string | null,
    total: deCentimos(r.total_cents as number | null),
    currency: r.currency as string,
    status: r.status as Status,
    receivedAt: r.received_at as string,
    warningCount: (JSON.parse(r.warnings as string) as string[]).length,
  };
}

export function listarFacturas(db: DB, f: InvoiceFilters = {}, limite = 500): InvoiceSummary[] {
  const { where, params } = condicionesFiltro(f);
  const rows = db.prepare(`${SELECT_RESUMEN} ${where} ORDER BY d.received_at DESC, i.id DESC LIMIT ?`).all(...params, limite) as Row[];
  return rows.map(aResumen);
}

export function obtenerFactura(db: DB, id: number): InvoiceDetail | null {
  const r = db
    .prepare(
      `SELECT i.*, d.received_at, d.filename, d.email_from, d.email_subject,
              s.name AS s_name, s.tax_id AS s_tax, s.address AS s_addr,
              c.name AS c_name, c.tax_id AS c_tax, c.address AS c_addr
       FROM invoices i
       JOIN source_documents d ON d.id = i.source_document_id
       LEFT JOIN suppliers s ON s.id = i.supplier_id
       LEFT JOIN customers c ON c.id = i.customer_id
       WHERE i.id = ?`,
    )
    .get(id) as Row | undefined;
  if (!r) return null;
  const lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY position').all(id) as Row[];
  const taxes = db.prepare('SELECT * FROM invoice_taxes WHERE invoice_id = ? ORDER BY id').all(id) as Row[];
  const party = (n: unknown, t: unknown, a: unknown): Party | null =>
    n ? { name: n as string, taxId: (t as string | null) ?? null, address: (a as string | null) ?? null } : null;
  return {
    id,
    status: r.status as Status,
    extractionMethod: r.extraction_method as 'heuristic' | 'llm',
    warnings: JSON.parse(r.warnings as string) as string[],
    receivedAt: r.received_at as string,
    validatedAt: r.validated_at as string | null,
    updatedAt: r.updated_at as string,
    source: { filename: r.filename as string, emailFrom: r.email_from as string | null, emailSubject: r.email_subject as string | null },
    supplier: party(r.s_name, r.s_tax, r.s_addr),
    customer: party(r.c_name, r.c_tax, r.c_addr),
    number: r.number as string | null,
    issueDate: r.issue_date as string | null,
    dueDate: r.due_date as string | null,
    currency: r.currency as string,
    subtotal: deCentimos(r.subtotal_cents as number | null),
    taxTotal: deCentimos(r.tax_total_cents as number | null),
    total: deCentimos(r.total_cents as number | null),
    notes: r.notes as string | null,
    lines: lines.map((l) => ({
      description: l.description as string,
      quantity: l.quantity as number | null,
      unitPrice: l.unit_price as number | null,
      discountPct: l.discount_pct as number | null,
      taxRate: l.tax_rate as number | null,
      total: deCentimos(l.line_total_cents as number | null),
    })),
    taxes: taxes.map((t) => ({
      type: t.tax_type as string,
      rate: t.rate as number,
      base: deCentimos(t.base_cents as number | null),
      amount: deCentimos(t.amount_cents as number | null),
    })),
  };
}

export function rutaPdf(db: DB, id: number): { path: string; filename: string } | null {
  const r = db
    .prepare('SELECT d.stored_path, d.filename FROM invoices i JOIN source_documents d ON d.id = i.source_document_id WHERE i.id = ?')
    .get(id) as { stored_path: string; filename: string } | undefined;
  return r ? { path: r.stored_path, filename: r.filename } : null;
}
