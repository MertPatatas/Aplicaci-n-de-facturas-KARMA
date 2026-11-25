import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { cambiarEstado, guardarFactura, obtenerFactura, urlPdf } from '../api';
import { recalcular, revisar, validar } from '../calc';
import { Campo, DateInput, NumInput, TextInput } from '../components/Fields';
import StatusBadge from '../components/StatusBadge';
import { fechaHora } from '../format';
import type { InvoiceData, InvoiceDetail as Factura, Line, Party, Tax } from '../types';

/** Solo los campos que se editan, para comparar contra lo guardado. */
const soloDatos = (f: Factura): InvoiceData => ({
  supplier: f.supplier, customer: f.customer, number: f.number, issueDate: f.issueDate, dueDate: f.dueDate,
  currency: f.currency, subtotal: f.subtotal, taxTotal: f.taxTotal, total: f.total, taxes: f.taxes, lines: f.lines, notes: f.notes,
});

const parteVacia: Party = { name: '', taxId: null, address: null };

function Parte({ titulo, valor, onChange }: { titulo: string; valor: Party | null; onChange: (p: Party | null) => void }) {
  const p = valor ?? parteVacia;
  const cambiar = (parche: Partial<Party>) => {
    const siguiente = { ...p, ...parche };
    onChange(!siguiente.name && !siguiente.taxId && !siguiente.address ? null : siguiente);
  };
  return (
    <fieldset>
      <legend>{titulo}</legend>
      <div className="rejilla">
        <Campo etiqueta="Nombre" ancho="doble">{(id) => <TextInput id={id} value={p.name || null} onChange={(v) => cambiar({ name: v ?? '' })} />}</Campo>
        <Campo etiqueta="NIF / CIF">{(id) => <TextInput id={id} value={p.taxId} onChange={(v) => cambiar({ taxId: v })} />}</Campo>
        <Campo etiqueta="Dirección" ancho="doble">{(id) => <TextInput id={id} value={p.address} onChange={(v) => cambiar({ address: v })} />}</Campo>
      </div>
    </fieldset>
  );
}

export default function InvoiceDetail() {
  const id = Number(useParams().id);
  const [guardada, setGuardada] = useState<Factura | null>(null);
  const [borrador, setBorrador] = useState<InvoiceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [vista, setVista] = useState<'datos' | 'pdf'>('datos');

  useEffect(() => {
    setGuardada(null);
    setBorrador(null);
    obtenerFactura(id)
      .then((f) => {
        setGuardada(f);
        setBorrador(soloDatos(f));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Error al cargar la factura'));
  }, [id]);

  const sucio = useMemo(
    () => !!guardada && !!borrador && JSON.stringify(soloDatos(guardada)) !== JSON.stringify(borrador),
    [guardada, borrador],
  );

  useEffect(() => {
    if (!sucio) return;
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [sucio]);

  if (error) return <p className="aviso error">{error} <Link to="/">Volver al listado</Link></p>;
  if (!guardada || !borrador) return <p className="vacio">Cargando...</p>;

  const d = borrador;
  const cambiar = (parche: Partial<InvoiceData>) => setBorrador({ ...d, ...parche });
  const cambiarLinea = (i: number, parche: Partial<Line>) => cambiar({ lines: d.lines.map((l, k) => (k === i ? { ...l, ...parche } : l)) });
  const cambiarImpuesto = (i: number, parche: Partial<Tax>) => cambiar({ taxes: d.taxes.map((t, k) => (k === i ? { ...t, ...parche } : t)) });
  const avisosVivos = revisar(d);
  const errores = validar(d);

  async function ejecutar(accion: () => Promise<Factura>, texto: string) {
    if (errores.length) {
      setMensaje({ tipo: 'error', texto: errores.join(' ') });
      return;
    }
    setTrabajando(true);
    try {
      const f = await accion();
      setGuardada(f);
      setBorrador(soloDatos(f));
      setMensaje({ tipo: 'ok', texto });
    } catch (e) {
      setMensaje({ tipo: 'error', texto: e instanceof Error ? e.message : 'No se pudo guardar' });
    } finally {
      setTrabajando(false);
    }
  }

  const guardar = () => ejecutar(() => guardarFactura(id, d), 'Cambios guardados.');
  const validarFactura = () => ejecutar(() => guardarFactura(id, d, 'validated'), 'Factura validada.');
  const cambiarEstadoSin = (status: 'pending_review' | 'rejected', texto: string) => {
    if (sucio && !window.confirm('Hay cambios sin guardar que se perderán. ¿Continuar?')) return;
    return ejecutar(() => cambiarEstado(id, status), texto);
  };

  return (
    <>
      <p className="migas"><Link to="/">← Facturas</Link></p>
      <div className="titulo-fila">
        <div>
          <h1>Factura {d.number ?? <em>sin número</em>}</h1>
          <p className="meta">
            <StatusBadge status={guardada.status} /> Recibida el {fechaHora(guardada.receivedAt)}
            {guardada.source.emailFrom && <> de {guardada.source.emailFrom}</>}
            {guardada.source.emailSubject && <> · «{guardada.source.emailSubject}»</>}
          </p>
        </div>
        <div className="acciones">
          {guardada.status === 'validated' ? (
            <button className="secundario" disabled={trabajando} onClick={() => cambiarEstadoSin('pending_review', 'Factura reabierta para revision.')}>Reabrir</button>
          ) : (
            <>
              <button className="peligro-suave" disabled={trabajando || guardada.status === 'rejected'} onClick={() => cambiarEstadoSin('rejected', 'Factura rechazada.')}>Rechazar</button>
              <button className="secundario" disabled={trabajando || !sucio} onClick={guardar}>Guardar</button>
              <button className="primario" disabled={trabajando} onClick={validarFactura}>Guardar y validar</button>
            </>
          )}
        </div>
      </div>

      {mensaje && <p className={`aviso ${mensaje.tipo}`} role="status">{mensaje.texto}</p>}
      {sucio && <p className="aviso pendiente">Hay cambios sin guardar.</p>}
      {(guardada.warnings.length > 0 || avisosVivos.length > 0) && guardada.status !== 'validated' && (
        <div className="aviso dudas">
          <strong>Conviene revisar:</strong>
          <ul>
            {[...new Set([...guardada.warnings, ...avisosVivos])].map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      )}

      <div className="selector-vista" role="tablist">
        <button role="tab" aria-selected={vista === 'datos'} className={vista === 'datos' ? 'activa' : ''} onClick={() => setVista('datos')}>Datos</button>
        <button role="tab" aria-selected={vista === 'pdf'} className={vista === 'pdf' ? 'activa' : ''} onClick={() => setVista('pdf')}>PDF original</button>
      </div>

      <div className="doble-panel" data-vista={vista}>
        <section className="panel-datos">
          {guardada.status === 'validated' && <p className="aviso">Factura validada. Para modificarla, pulsa «Reabrir».</p>}
          <fieldset className="sin-borde" disabled={guardada.status === 'validated'}>
          <fieldset>
            <legend>Cabecera</legend>
            <div className="rejilla">
              <Campo etiqueta="Número de factura">{(i) => <TextInput id={i} value={d.number} onChange={(v) => cambiar({ number: v })} />}</Campo>
              <Campo etiqueta="Fecha de emisión">{(i) => <DateInput id={i} value={d.issueDate} onChange={(v) => cambiar({ issueDate: v })} />}</Campo>
              <Campo etiqueta="Fecha de vencimiento">{(i) => <DateInput id={i} value={d.dueDate} onChange={(v) => cambiar({ dueDate: v })} />}</Campo>
              <Campo etiqueta="Moneda">{(i) => <TextInput id={i} maxLength={3} value={d.currency} onChange={(v) => cambiar({ currency: (v ?? '').toUpperCase() })} />}</Campo>
            </div>
          </fieldset>

          <Parte titulo="Emisor" valor={d.supplier} onChange={(p) => cambiar({ supplier: p })} />
          <Parte titulo="Cliente" valor={d.customer} onChange={(p) => cambiar({ customer: p })} />

          <fieldset>
            <legend>Líneas</legend>
            <table className="tabla tabla-edicion">
              <thead>
                <tr><th>Concepto</th><th className="n">Cantidad</th><th className="n">Precio</th><th className="n">Dto. %</th><th className="n">IVA %</th><th className="n">Importe</th><th /></tr>
              </thead>
              <tbody>
                {d.lines.map((l, i) => (
                  <tr key={i}>
                    <td data-label="Concepto"><TextInput aria-label="Concepto" value={l.description || null} onChange={(v) => cambiarLinea(i, { description: v ?? '' })} /></td>
                    <td data-label="Cantidad"><NumInput aria-label="Cantidad" value={l.quantity} onChange={(v) => cambiarLinea(i, { quantity: v })} /></td>
                    <td data-label="Precio"><NumInput aria-label="Precio unitario" value={l.unitPrice} onChange={(v) => cambiarLinea(i, { unitPrice: v })} /></td>
                    <td data-label="Dto. %"><NumInput aria-label="Descuento" value={l.discountPct} onChange={(v) => cambiarLinea(i, { discountPct: v })} /></td>
                    <td data-label="IVA %"><NumInput aria-label="IVA de la línea" value={l.taxRate} onChange={(v) => cambiarLinea(i, { taxRate: v })} /></td>
                    <td data-label="Importe"><NumInput aria-label="Importe de la línea" value={l.total} onChange={(v) => cambiarLinea(i, { total: v })} /></td>
                    <td className="quitar"><button type="button" className="icono" aria-label={`Quitar línea ${i + 1}`} onClick={() => cambiar({ lines: d.lines.filter((_, k) => k !== i) })}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.lines.length === 0 && <p className="vacio">No hay líneas. Añade las que falten.</p>}
            <button type="button" className="secundario" onClick={() => cambiar({ lines: [...d.lines, { description: '', quantity: 1, unitPrice: null, discountPct: null, taxRate: null, total: null }] })}>
              + Añadir línea
            </button>
          </fieldset>

          <fieldset>
            <legend>Impuestos y retenciones</legend>
            <table className="tabla tabla-edicion tabla-impuestos">
              <thead><tr><th>Tipo</th><th className="n">%</th><th className="n">Base</th><th className="n">Cuota</th><th /></tr></thead>
              <tbody>
                {d.taxes.map((t, i) => (
                  <tr key={i}>
                    <td data-label="Tipo"><TextInput aria-label="Tipo de impuesto" value={t.type} onChange={(v) => cambiarImpuesto(i, { type: (v ?? '').toUpperCase() })} /></td>
                    <td data-label="%"><NumInput aria-label="Porcentaje" value={t.rate} onChange={(v) => cambiarImpuesto(i, { rate: v ?? 0 })} /></td>
                    <td data-label="Base"><NumInput aria-label="Base" value={t.base} onChange={(v) => cambiarImpuesto(i, { base: v })} /></td>
                    <td data-label="Cuota"><NumInput aria-label="Cuota" value={t.amount} onChange={(v) => cambiarImpuesto(i, { amount: v })} /></td>
                    <td className="quitar"><button type="button" className="icono" aria-label={`Quitar impuesto ${i + 1}`} onClick={() => cambiar({ taxes: d.taxes.filter((_, k) => k !== i) })}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="secundario" onClick={() => cambiar({ taxes: [...d.taxes, { type: 'IVA', rate: 21, base: d.subtotal, amount: null }] })}>
              + Añadir impuesto
            </button>
          </fieldset>

          <fieldset>
            <legend>Totales</legend>
            <div className="rejilla">
              <Campo etiqueta="Base imponible">{(i) => <NumInput id={i} value={d.subtotal} onChange={(v) => cambiar({ subtotal: v })} />}</Campo>
              <Campo etiqueta="Total impuestos">{(i) => <NumInput id={i} value={d.taxTotal} onChange={(v) => cambiar({ taxTotal: v })} />}</Campo>
              <Campo etiqueta="Total factura">{(i) => <NumInput id={i} value={d.total} onChange={(v) => cambiar({ total: v })} />}</Campo>
            </div>
            <button type="button" className="secundario" onClick={() => setBorrador(recalcular(d))} title="Rehace importes de línea, base, cuotas y total a partir de cantidad, precio y descuento">
              Recalcular totales
            </button>
          </fieldset>

          <fieldset>
            <legend>Notas</legend>
            <textarea rows={3} value={d.notes ?? ''} onChange={(e) => cambiar({ notes: e.target.value || null })} aria-label="Notas" />
          </fieldset>
          </fieldset>
        </section>

        <section className="panel-pdf">
          <iframe title="PDF original de la factura" src={urlPdf(id)} />
          <p className="meta"><a href={urlPdf(id)} target="_blank" rel="noreferrer">Abrir el PDF en otra pestaña</a> · {guardada.source.filename}</p>
        </section>
      </div>
    </>
  );
}

