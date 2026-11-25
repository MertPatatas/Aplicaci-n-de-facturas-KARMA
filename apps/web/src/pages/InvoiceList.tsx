import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listarFacturas } from '../api';
import StatusBadge from '../components/StatusBadge';
import { eur, fecha, fechaHora } from '../format';
import { STATUS_LABEL, type InvoiceSummary, type Status } from '../types';

type Pestana = 'todas' | Status;
const PESTANAS: Pestana[] = ['todas', 'pending_review', 'validated', 'rejected'];

export default function InvoiceList() {
  const [facturas, setFacturas] = useState<InvoiceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [pestana, setPestana] = useState<Pestana>('todas');

  const cargar = useCallback(async () => {
    try {
      setFacturas(await listarFacturas({ q: busqueda.trim() || undefined }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el listado');
    }
  }, [busqueda]);

  // Recarga al escribir (con una pausa corta), cada 30 s y al volver a la pestana,
  // porque las facturas llegan solas desde el correo
  useEffect(() => {
    const t = setTimeout(cargar, 250);
    const intervalo = setInterval(cargar, 30_000);
    window.addEventListener('focus', cargar);
    return () => {
      clearTimeout(t);
      clearInterval(intervalo);
      window.removeEventListener('focus', cargar);
    };
  }, [cargar]);

  const cuentas = useMemo(() => {
    const c: Record<Pestana, number> = { todas: 0, pending_review: 0, validated: 0, rejected: 0 };
    for (const f of facturas ?? []) {
      c.todas++;
      c[f.status]++;
    }
    return c;
  }, [facturas]);

  const visibles = (facturas ?? []).filter((f) => pestana === 'todas' || f.status === pestana);

  return (
    <>
      <div className="titulo-fila">
        <h1>Facturas</h1>
        <input
          className="buscador"
          type="search"
          placeholder="Buscar por proveedor o número"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          aria-label="Buscar facturas"
        />
      </div>

      <div className="pestanas" role="tablist">
        {PESTANAS.map((p) => (
          <button key={p} role="tab" aria-selected={pestana === p} className={pestana === p ? 'activa' : ''} onClick={() => setPestana(p)}>
            {p === 'todas' ? 'Todas' : STATUS_LABEL[p]} <span className="contador">{cuentas[p]}</span>
          </button>
        ))}
      </div>

      {error && <p className="aviso error">{error}</p>}
      {facturas === null && !error && <p className="vacio">Cargando...</p>}
      {facturas !== null && visibles.length === 0 && (
        <p className="vacio">
          {facturas.length === 0 ? 'Todavía no ha llegado ninguna factura.' : 'No hay facturas con este filtro.'}
        </p>
      )}

      {visibles.length > 0 && (
        <table className="tabla tabla-facturas">
          <thead>
            <tr>
              <th>Recibida</th>
              <th>Proveedor</th>
              <th>Número</th>
              <th>Fecha factura</th>
              <th className="n">Total</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => (
              <tr key={f.id}>
                <td data-label="Recibida">{fechaHora(f.receivedAt)}</td>
                <td data-label="Proveedor" className="principal">
                  <Link to={`/facturas/${f.id}`}>{f.supplierName ?? <em>Sin identificar</em>}</Link>
                </td>
                <td data-label="Número">{f.number ?? <em>Sin número</em>}</td>
                <td data-label="Fecha factura">{fecha(f.issueDate)}</td>
                <td data-label="Total" className="n">{eur(f.total, f.currency)}</td>
                <td data-label="Estado">
                  <StatusBadge status={f.status} />
                  {f.warningCount > 0 && f.status === 'pending_review' && (
                    <span className="avisos" title="El lector ha marcado dudas en esta factura">
                      {f.warningCount} {f.warningCount === 1 ? 'aviso' : 'avisos'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
