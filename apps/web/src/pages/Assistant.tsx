import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { preguntar } from '../api';
import { eur } from '../format';
import type { InvoiceSummary } from '../types';

interface Mensaje {
  autor: 'yo' | 'asistente';
  texto: string;
  facturas?: InvoiceSummary[];
  modo?: string;
}

const SUGERENCIAS = [
  '¿Cuántas facturas han llegado hoy?',
  '¿Ha llegado alguna factura superior a 100 €?',
  'Hazme un resumen del día',
  '¿Cuál ha sido el importe total facturado hoy?',
  '¿Qué proveedores han enviado facturas esta semana?',
  '¿Hay alguna factura pendiente de revisar?',
  '¿Cuál es la factura de mayor importe recibida hoy?',
];

// La API de reconocimiento de voz del navegador no esta en los tipos de TypeScript
interface Reconocimiento {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type ConstructorReconocimiento = new () => Reconocimiento;

const Voz = (window as unknown as { SpeechRecognition?: ConstructorReconocimiento; webkitSpeechRecognition?: ConstructorReconocimiento })
  .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: ConstructorReconocimiento }).webkitSpeechRecognition;

export default function Assistant() {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [escuchando, setEscuchando] = useState(false);
  const [leerEnVoz, setLeerEnVoz] = useState(false);
  const [errorVoz, setErrorVoz] = useState<string | null>(null);
  const reconocimiento = useRef<Reconocimiento | null>(null);
  const final = useRef('');
  const fin = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fin.current?.scrollIntoView({ block: 'end' });
  }, [mensajes]);
  useEffect(() => {
    return () => {
      reconocimiento.current?.stop();
      window.speechSynthesis?.cancel();
    };
  }, []);

  async function enviar(pregunta: string) {
    const limpia = pregunta.trim();
    if (!limpia || enviando) return;
    setMensajes((m) => [...m, { autor: 'yo', texto: limpia }]);
    setTexto('');
    setEnviando(true);
    try {
      const r = await preguntar(limpia);
      setMensajes((m) => [...m, { autor: 'asistente', texto: r.answer, facturas: r.invoices, modo: r.mode }]);
      if (leerEnVoz && window.speechSynthesis) {
        window.speechSynthesis.cancel();
        const voz = new SpeechSynthesisUtterance(r.answer);
        voz.lang = 'es-ES';
        window.speechSynthesis.speak(voz);
      }
    } catch (e) {
      setMensajes((m) => [...m, { autor: 'asistente', texto: e instanceof Error ? e.message : 'No he podido consultar los datos.' }]);
    } finally {
      setEnviando(false);
    }
  }

  function alternarMicrofono() {
    if (!Voz) return;
    if (escuchando) {
      reconocimiento.current?.stop();
      return;
    }
    setErrorVoz(null);
    final.current = '';
    const r = new Voz();
    r.lang = 'es-ES';
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let parcial = '';
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]!;
        const t = res[0]!.transcript;
        if (res.isFinal) final.current = (final.current + ' ' + t).trim();
        else parcial += t;
      }
      setTexto((final.current + ' ' + parcial).trim());
    };
    r.onerror = (e) => {
      setErrorVoz(
        e.error === 'not-allowed' ? 'El navegador no tiene permiso para usar el micrófono.' : e.error === 'no-speech' ? 'No se ha oído nada.' : `Error de voz: ${e.error}`,
      );
    };
    r.onend = () => {
      setEscuchando(false);
      if (final.current) void enviar(final.current);
    };
    reconocimiento.current = r;
    setEscuchando(true);
    r.start();
  }

  const alEnviar = (e: FormEvent) => {
    e.preventDefault();
    void enviar(texto);
  };

  return (
    <>
      <h1>Asistente</h1>
      <p className="meta">Pregunta por texto o con el micrófono. Las respuestas salen de las facturas guardadas en la base de datos.</p>

      <div className="chat" aria-live="polite">
        {mensajes.length === 0 && (
          <div className="sugerencias">
            <p>Prueba con una de estas:</p>
            {SUGERENCIAS.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => enviar(s)}>{s}</button>
            ))}
          </div>
        )}
        {mensajes.map((m, i) => (
          <div key={i} className={`burbuja ${m.autor}`}>
            <p>{m.texto}</p>
            {m.facturas && m.facturas.length > 0 && (
              <ul className="facturas-citadas">
                {m.facturas.slice(0, 8).map((f) => (
                  <li key={f.id}>
                    <Link to={`/facturas/${f.id}`}>{f.supplierName ?? 'Sin proveedor'} · {f.number ?? 'sin número'}</Link> <span>{eur(f.total, f.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {enviando && <div className="burbuja asistente"><p>Consultando...</p></div>}
        <div ref={fin} />
      </div>

      <form className="entrada-chat" onSubmit={alEnviar}>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={escuchando ? 'Te escucho...' : 'Escribe tu pregunta'} aria-label="Pregunta" />
        {Voz && (
          <button type="button" className={`microfono${escuchando ? ' activo' : ''}`} onClick={alternarMicrofono} aria-pressed={escuchando} aria-label={escuchando ? 'Dejar de escuchar' : 'Preguntar con la voz'}>
            {escuchando ? (
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" /></svg>
            )}
          </button>
        )}
        <button className="primario" type="submit" disabled={enviando || !texto.trim()}>Enviar</button>
      </form>
      <div className="opciones-chat">
        {Voz ? (
          <label><input type="checkbox" checked={leerEnVoz} onChange={(e) => setLeerEnVoz(e.target.checked)} /> Leer las respuestas en voz alta</label>
        ) : (
          <span className="meta">Este navegador no permite dictado por voz. Usa Chrome, Edge o Safari para preguntar hablando.</span>
        )}
        {errorVoz && <span className="aviso error">{errorVoz}</span>}
      </div>
    </>
  );
}
