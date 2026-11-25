# Arquitectura

## Visión general

```
Buzón IMAP
   |
   v
n8n (flujo-facturas.json)
   |  POST multipart + cabecera x-ingest-token
   v
API Express  --->  extracción (reglas, o modelo si hay clave)
   |                         |
   v                         v
SQLite (data/)         PDF original (data/pdf/<sha256>.pdf)
   ^
   |  REST
React (lista, detalle editable, asistente)
```

n8n solo transporta: no interpreta el PDF ni toca la base de datos. Toda la lógica está en la API, de modo que la misma ingesta se puede lanzar desde un script (`npm run muestras:enviar`) o desde otro cliente.

## Flujo de una factura

1. n8n recibe un correo y separa los adjuntos PDF.
2. Cada PDF se envía a `POST /api/ingest`. La API comprueba el token, que el fichero empiece por `%PDF` y su tamaño (máximo 20 MB).
3. Se calcula el SHA-256. Si ya existe un documento con ese hash, responde 200 con `duplicate: true` y no crea nada.
4. Se extrae el texto y los datos. Con PDF ilegible responde 422.
5. En una transacción se guardan proveedor, cliente, documento origen, factura, líneas e impuestos. El estado inicial es `pending_review`.
6. Una persona revisa en la web, corrige y pulsa validar (o rechaza).

## Modelo de datos

Esquema en `apps/api/migrations/001_esquema_inicial.sql`.

- suppliers y customers: nombre, NIF y dirección. Se reutilizan por NIF y, si no hay NIF, por nombre sin distinguir mayúsculas.
- source_documents: datos del correo (remitente, asunto, fecha de recepción, message id), nombre del fichero y hash. El hash es único.
- invoices: número, fechas, moneda, base, impuestos y total, estado (`pending_review`, `validated`, `rejected`), método de extracción (`heuristic` o `llm`) y avisos en JSON.
- invoice_lines: concepto, cantidad, precio unitario, descuento, IVA e importe.
- invoice_taxes: tipo (IVA o IRPF), porcentaje, base e importe. Las retenciones de IRPF se guardan con importe negativo.

Los importes se guardan en céntimos como enteros para evitar errores de coma flotante. El precio unitario es REAL porque puede tener más de dos decimales. La API expone los importes en euros.

## Decisiones

SQLite en vez de una base en la nube. El enunciado admite local o nube. SQLite no necesita servidor ni cuentas y `node:sqlite` viene con Node 22. Si se quisiera varias instancias o acceso remoto, habría que migrar a PostgreSQL; el acceso está concentrado en `repo.ts` y `assistant/tools.ts`.

Extracción en el backend y no en n8n. Se puede testear con vitest, versionar y reutilizar. En n8n quedaría repartida entre nodos Code difíciles de probar.

Reglas primero, modelo opcional. El lector por reglas funciona sin coste ni dependencias externas y es determinista. El modelo mejora la cobertura de formatos raros, pero requiere clave y pago por uso, por lo que está apagado por defecto y siempre con vuelta al lector por reglas si falla.

Lectura por posiciones. El texto plano de un PDF mezcla columnas y tablas. Se reconstruyen líneas y celdas con las coordenadas de cada fragmento (una separación horizontal mayor que 0,8 veces la altura de la letra parte una celda). Así se distinguen emisor y cliente cuando están en columnas contiguas.

Todo entra como pendiente. Una extracción automática se equivoca, así que ninguna factura se da por buena sin pasar por una persona. Los avisos de coherencia indican dónde mirar.

Asistente por intenciones. Un intérprete por reglas traduce la pregunta a una consulta (qué se pide, periodo, proveedor, umbral de importe) y la ejecuta con las mismas funciones que usa el modo con modelo. Las cifras salen siempre de SQL, no del texto generado. Los periodos se calculan en Europe/Madrid, con el cambio de hora incluido, sobre la fecha de recepción.

Voz en el navegador. La Web Speech API evita enviar audio a un servicio de pago y no añade dependencias. Como contrapartida depende del navegador y la calidad del reconocimiento no es controlable.

Token de ingesta. La API de ingesta es la única parte pensada para que la llame un sistema externo, y se protege con un token compartido en cabecera. El resto de la API y la web no tienen autenticación, porque el enunciado no la pide.

## Operación

- Los datos viven en `DATA_DIR`. Para una copia de seguridad basta con copiar esa carpeta (base SQLite y PDF).
- Las migraciones se aplican al arrancar.
- Si n8n deja de entregar, las ejecuciones fallidas se ven en su panel. El correo se marca como leído al procesarlo, así que un fallo de la API no reintenta solo después de agotar los tres intentos.
- Para reprocesar un PDF rechazado o mal leído hay que corregirlo en la interfaz, no volver a enviarlo, porque el hash lo detectaría como duplicado.

## Limitaciones

Ver el final del README.
