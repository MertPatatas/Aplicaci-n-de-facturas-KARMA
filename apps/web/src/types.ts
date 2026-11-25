// Mismos tipos que devuelve la API (apps/api/src/repo.ts y schema.ts).
// Se repiten aqui a proposito: son pocos y evita acoplar el build de la web al de la API.

export type Status = 'pending_review' | 'validated' | 'rejected';

export interface Party {
  name: string;
  taxId: string | null;
  address: string | null;
}

export interface Line {
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  discountPct: number | null;
  taxRate: number | null;
  total: number | null;
}

export interface Tax {
  type: string;
  rate: number;
  base: number | null;
  amount: number | null;
}

export interface InvoiceData {
  supplier: Party | null;
  customer: Party | null;
  number: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  subtotal: number | null;
  taxTotal: number | null;
  total: number | null;
  taxes: Tax[];
  lines: Line[];
  notes: string | null;
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

export interface AssistantReply {
  answer: string;
  intent: string;
  invoices: InvoiceSummary[];
  mode: 'reglas' | 'modelo';
}

export const STATUS_LABEL: Record<Status, string> = {
  pending_review: 'Pendiente de revisar',
  validated: 'Validada',
  rejected: 'Rechazada',
};
