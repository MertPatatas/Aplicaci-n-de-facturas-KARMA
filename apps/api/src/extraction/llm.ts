import { invoiceDataSchema, type InvoiceData } from '../schema.js';

const SISTEMA = `Eres un extractor de datos de facturas. Recibes el texto de una factura (las columnas separadas por dos espacios) y devuelves SOLO un objeto JSON, sin explicaciones ni bloques de código, con esta forma:

{
  "supplier": {"name": string, "taxId": string|null, "address": string|null} | null,
  "customer": {"name": string, "taxId": string|null, "address": string|null} | null,
  "number": string|null,
  "issueDate": "AAAA-MM-DD"|null,
  "dueDate": "AAAA-MM-DD"|null,
  "currency": "EUR",
  "subtotal": number|null,
  "taxTotal": number|null,
  "total": number|null,
  "taxes": [{"type": "IVA"|"IRPF"|..., "rate": number, "base": number|null, "amount": number|null}],
  "lines": [{"description": string, "quantity": number|null, "unitPrice": number|null, "discountPct": number|null, "taxRate": number|null, "total": number|null}],
  "notes": string|null
}

Reglas: los importes son números en la moneda de la factura, sin símbolos y con punto decimal. Las retenciones (IRPF) llevan importe negativo. Si un dato no aparece en el documento, pon null; no lo inventes. El emisor es quien expide la factura y el cliente quien la recibe.`;

export interface ModeloConfig {
  apiKey: string;
  model: string;
}

type FetchFn = typeof fetch;

export async function extraerConModelo(texto: string, cfg: ModeloConfig, fetchFn: FetchFn = fetch): Promise<InvoiceData> {
  const res = await fetchFn('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 4096,
      system: SISTEMA,
      messages: [{ role: 'user', content: texto }],
    }),
  });
  if (!res.ok) throw new Error(`El modelo respondio ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const cuerpo = (await res.json()) as { content?: { type: string; text?: string }[] };
  const respuesta = cuerpo.content?.find((b) => b.type === 'text')?.text ?? '';
  const ini = respuesta.indexOf('{');
  const fin = respuesta.lastIndexOf('}');
  if (ini < 0 || fin <= ini) throw new Error('El modelo no devolvio un JSON');
  return invoiceDataSchema.parse(JSON.parse(respuesta.slice(ini, fin + 1)));
}
