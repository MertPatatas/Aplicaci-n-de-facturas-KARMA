import { useEffect, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';

export function Campo({ etiqueta, children, ancho }: { etiqueta: string; children: (id: string) => ReactNode; ancho?: 'doble' }) {
  const id = useId();
  return (
    <div className={`campo${ancho ? ' ' + ancho : ''}`}>
      <label htmlFor={id}>{etiqueta}</label>
      {children(id)}
    </div>
  );
}

const aNumero = (t: string): number | null => {
  const limpio = t.trim().replace(',', '.');
  if (!limpio || limpio === '-' || limpio === '.') return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
};

type Base = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>;

/** Campo numerico que admite coma o punto y deja escribir valores a medias ("12,"). */
export function NumInput({ value, onChange, ...resto }: Base & { value: number | null; onChange: (v: number | null) => void }) {
  const [texto, setTexto] = useState(value == null ? '' : String(value));
  useEffect(() => {
    if (aNumero(texto) !== value) setTexto(value == null ? '' : String(value));
    // solo se resincroniza cuando cambia el valor desde fuera (por ejemplo al recalcular)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      {...resto}
      type="text"
      inputMode="decimal"
      value={texto}
      onChange={(e) => {
        if (!/^-?\d*[.,]?\d*$/.test(e.target.value)) return;
        setTexto(e.target.value);
        onChange(aNumero(e.target.value));
      }}
    />
  );
}

export function TextInput({ value, onChange, ...resto }: Base & { value: string | null; onChange: (v: string | null) => void }) {
  return <input {...resto} type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)} />;
}

export function DateInput({ value, onChange, ...resto }: Base & { value: string | null; onChange: (v: string | null) => void }) {
  return <input {...resto} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)} />;
}
