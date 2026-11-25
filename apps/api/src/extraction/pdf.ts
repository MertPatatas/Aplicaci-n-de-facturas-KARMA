import { getDocumentProxy } from 'unpdf';

export interface Cell {
  text: string;
  x: number;
}

export interface Line {
  page: number;
  y: number;
  cells: Cell[];
  /** Celdas unidas con dos espacios, para buscar patrones en toda la linea. */
  text: string;
}

interface Item {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function esPdf(buffer: Uint8Array): boolean {
  // Los PDF empiezan por "%PDF-", a veces con algo de basura delante
  const cabecera = Buffer.from(buffer.subarray(0, 1024)).toString('latin1');
  return cabecera.includes('%PDF-');
}

/**
 * Devuelve el texto del PDF como lineas con sus celdas y la posicion x de cada
 * una. Las columnas de las tablas y los bloques en paralelo (emisor / cliente)
 * se distinguen por los huecos horizontales entre fragmentos de texto.
 */
export async function leerLineas(data: Uint8Array): Promise<Line[]> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const lineas: Line[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const items: Item[] = [];
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      items.push({
        str: it.str,
        x: it.transform[4] as number,
        y: it.transform[5] as number,
        width: it.width,
        height: Math.abs(it.height) || Math.abs(it.transform[3] as number) || 10,
      });
    }
    lineas.push(...agrupar(items, n));
  }
  return lineas;
}

function agrupar(items: Item[], page: number): Line[] {
  // De arriba a abajo (en PDF la y crece hacia arriba) y de izquierda a derecha
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const filas: Item[][] = [];
  for (const it of items) {
    const fila = filas[filas.length - 1];
    if (fila && Math.abs(fila[0]!.y - it.y) <= Math.max(2, it.height * 0.3)) fila.push(it);
    else filas.push([it]);
  }
  return filas.map((fila) => {
    fila.sort((a, b) => a.x - b.x);
    const cells: Cell[] = [];
    let actual: { text: string; x: number; fin: number; alto: number } | null = null;
    for (const it of fila) {
      if (actual) {
        const hueco = it.x - actual.fin;
        if (hueco > actual.alto * 0.8) {
          cells.push({ text: actual.text.trim(), x: actual.x });
          actual = null;
        } else {
          const pegado = actual.text.endsWith(' ') || it.str.startsWith(' ') || hueco < actual.alto * 0.15;
          actual.text += (pegado ? '' : ' ') + it.str;
          actual.fin = it.x + it.width;
          continue;
        }
      }
      actual = { text: it.str, x: it.x, fin: it.x + it.width, alto: it.height };
    }
    if (actual) cells.push({ text: actual.text.trim(), x: actual.x });
    const limpias = cells.filter((c) => c.text);
    return { page, y: fila[0]!.y, cells: limpias, text: limpias.map((c) => c.text).join('  ') };
  });
}

export function lineasATexto(lineas: Line[]): string {
  return lineas.map((l) => l.text).join('\n');
}
