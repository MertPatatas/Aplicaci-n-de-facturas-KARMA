-- Esquema inicial. Los importes van en centimos (INTEGER) para no arrastrar
-- errores de coma flotante. Los precios unitarios son REAL porque pueden
-- tener mas de dos decimales.

CREATE TABLE suppliers (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  tax_id     TEXT,
  address    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX ux_suppliers_tax_id ON suppliers (tax_id) WHERE tax_id IS NOT NULL;
CREATE UNIQUE INDEX ux_suppliers_name ON suppliers (lower(name)) WHERE tax_id IS NULL;

CREATE TABLE customers (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  tax_id     TEXT,
  address    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX ux_customers_tax_id ON customers (tax_id) WHERE tax_id IS NOT NULL;
CREATE UNIQUE INDEX ux_customers_name ON customers (lower(name)) WHERE tax_id IS NULL;

-- Un registro por PDF recibido, con los datos del correo del que viene.
CREATE TABLE source_documents (
  id               INTEGER PRIMARY KEY,
  filename         TEXT NOT NULL,
  sha256           TEXT NOT NULL UNIQUE,
  stored_path      TEXT NOT NULL,
  size_bytes       INTEGER NOT NULL,
  email_message_id TEXT,
  email_from       TEXT,
  email_subject    TEXT,
  received_at      TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ix_source_documents_received_at ON source_documents (received_at);

CREATE TABLE invoices (
  id                 INTEGER PRIMARY KEY,
  source_document_id INTEGER NOT NULL UNIQUE REFERENCES source_documents (id),
  supplier_id        INTEGER REFERENCES suppliers (id),
  customer_id        INTEGER REFERENCES customers (id),
  number             TEXT,
  issue_date         TEXT,
  due_date           TEXT,
  currency           TEXT NOT NULL DEFAULT 'EUR',
  subtotal_cents     INTEGER,
  tax_total_cents    INTEGER,
  total_cents        INTEGER,
  status             TEXT NOT NULL DEFAULT 'pending_review'
                     CHECK (status IN ('pending_review', 'validated', 'rejected')),
  extraction_method  TEXT NOT NULL CHECK (extraction_method IN ('heuristic', 'llm')),
  warnings           TEXT NOT NULL DEFAULT '[]',
  notes              TEXT,
  validated_at       TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ix_invoices_status ON invoices (status);
CREATE INDEX ix_invoices_supplier ON invoices (supplier_id);
CREATE INDEX ix_invoices_issue_date ON invoices (issue_date);

CREATE TABLE invoice_lines (
  id               INTEGER PRIMARY KEY,
  invoice_id       INTEGER NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  position         INTEGER NOT NULL,
  description      TEXT NOT NULL,
  quantity         REAL,
  unit_price       REAL,
  discount_pct     REAL,
  tax_rate         REAL,
  line_total_cents INTEGER,
  UNIQUE (invoice_id, position)
);

-- Impuestos y retenciones de cabecera. Una factura puede mezclar tipos de IVA
-- o llevar IRPF, por eso es una tabla y no una columna.
CREATE TABLE invoice_taxes (
  id           INTEGER PRIMARY KEY,
  invoice_id   INTEGER NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  tax_type     TEXT NOT NULL DEFAULT 'IVA',
  rate         REAL NOT NULL,
  base_cents   INTEGER,
  amount_cents INTEGER
);
CREATE INDEX ix_invoice_taxes_invoice ON invoice_taxes (invoice_id);
