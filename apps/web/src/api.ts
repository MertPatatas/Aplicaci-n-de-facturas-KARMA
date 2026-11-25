import type { AssistantReply, InvoiceData, InvoiceDetail, InvoiceSummary, Status } from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { error?: string; detalles?: string[] } | null;
    const detalle = cuerpo?.detalles?.length ? ': ' + cuerpo.detalles.join('; ') : '';
    throw new Error((cuerpo?.error ?? `Error ${res.status}`) + detalle);
  }
  return res.json() as Promise<T>;
}

export interface Filtros {
  status?: Status;
  q?: string;
}

export const listarFacturas = (f: Filtros) => {
  const params = new URLSearchParams();
  if (f.status) params.set('status', f.status);
  if (f.q) params.set('q', f.q);
  return request<InvoiceSummary[]>(`/api/invoices?${params}`);
};

export const obtenerFactura = (id: number) => request<InvoiceDetail>(`/api/invoices/${id}`);

export const guardarFactura = (id: number, datos: InvoiceData, status?: Status) =>
  request<InvoiceDetail>(`/api/invoices/${id}`, { method: 'PUT', body: JSON.stringify({ ...datos, status }) });

export const cambiarEstado = (id: number, status: Status) =>
  request<InvoiceDetail>(`/api/invoices/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });

export const preguntar = (message: string) =>
  request<AssistantReply>('/api/assistant', { method: 'POST', body: JSON.stringify({ message }) });

export const urlPdf = (id: number) => `/api/invoices/${id}/pdf`;
