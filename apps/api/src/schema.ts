import { z } from 'zod';

export const STATUSES = ['pending_review', 'validated', 'rejected'] as const;
export type Status = (typeof STATUSES)[number];

const importe = z.number().finite().nullable();
const fechaIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato AAAA-MM-DD')
  .nullable();

export const partySchema = z.object({
  name: z.string().trim().min(1),
  taxId: z.string().trim().min(1).nullable().default(null),
  address: z.string().trim().min(1).nullable().default(null),
});

export const lineSchema = z.object({
  description: z.string().trim().min(1),
  quantity: z.number().finite().nullable().default(null),
  unitPrice: z.number().finite().nullable().default(null),
  discountPct: z.number().finite().nullable().default(null),
  taxRate: z.number().finite().nullable().default(null),
  total: importe.default(null),
});

export const taxSchema = z.object({
  type: z.string().trim().min(1).default('IVA'),
  rate: z.number().finite(),
  base: importe.default(null),
  amount: importe.default(null),
});

/** Datos de una factura tal y como los extrae el lector y los edita la persona. */
export const invoiceDataSchema = z.object({
  supplier: partySchema.nullable().default(null),
  customer: partySchema.nullable().default(null),
  number: z.string().trim().min(1).nullable().default(null),
  issueDate: fechaIso.default(null),
  dueDate: fechaIso.default(null),
  currency: z.string().trim().length(3).default('EUR'),
  subtotal: importe.default(null),
  taxTotal: importe.default(null),
  total: importe.default(null),
  taxes: z.array(taxSchema).default([]),
  lines: z.array(lineSchema).default([]),
  notes: z.string().nullable().default(null),
});

export const invoiceUpdateSchema = invoiceDataSchema.extend({
  status: z.enum(STATUSES).optional(),
});

export type Party = z.infer<typeof partySchema>;
export type InvoiceLine = z.infer<typeof lineSchema>;
export type InvoiceTax = z.infer<typeof taxSchema>;
export type InvoiceData = z.infer<typeof invoiceDataSchema>;
export type InvoiceUpdate = z.infer<typeof invoiceUpdateSchema>;

export function emptyInvoice(): InvoiceData {
  return invoiceDataSchema.parse({});
}
