# Lector de facturas

Aplicación web que recibe facturas en PDF por correo, extrae sus datos, las guarda en una base de datos y deja revisarlas, corregirlas y validarlas. Incluye un asistente al que se pregunta por texto o por voz ("¿cuántas facturas han llegado hoy?", "¿cuál es la de mayor importe?") y que responde con los datos guardados.

Es el entregable técnico "Aplicativo de lectura e interpretación de facturas".

## Uso de IA en este proyecto

Para desarrollarlo se ha usado un asistente de IA (Claude, de Anthropic) como apoyo: generación de borradores de código, de los tests y de parte de la documentación, y revisión de errores. El diseño, las decisiones, la revisión del código y las pruebas finales las he hecho yo. Quien lo evalúe debe tener en cuenta que parte del código partió de ese apoyo.

Además, la aplicación puede usar un modelo de lenguaje en tiempo de ejecución, pero es opcional y está desactivado por defecto (ver "Modo con modelo").

## Qué hay

- `apps/web`: interfaz en React + TypeScript (Vite). Lista de facturas, detalle editable con el PDF al lado y pantalla del asistente. Es responsive: en móvil las tablas pasan a tarjetas y en tablet el detalle se divide en pestañas Datos y PDF.
- `apps/api`: API en Node con Express, SQLite y el lector de PDF. También sirve la web compilada.
- `n8n/flujo-facturas.json`: flujo de n8n que lee el buzón, se queda con los adjuntos PDF y los envía a la API.
- `samples`: cinco PDF de ejemplo (cuatro facturas con formatos distintos y un PDF que no es factura) y el HTML a partir del que se generaron.
- `docs/arquitectura.md`: arquitectura, modelo de datos y decisiones.

## Requisitos

Node 22.13 o superior. La base de datos usa el módulo `node:sqlite`, así que no hace falta instalar nada más. Para el flujo de correo hace falta n8n (con Docker Compose se levanta junto a la app).

## Puesta en marcha en local

```
npm install
cp .env.example .env
npm run dev
```

La web queda en http://localhost:5173 (con proxy a la API) y la API en http://localhost:3001. Los datos se guardan en `data/` (base SQLite y PDF originales).

Para cargar facturas sin correo:

```
npm run muestras:enviar
```

Envía los PDF de `samples/pdf` a `/api/ingest` con la misma petición que hace n8n. Con `-- --todas` incluye también el PDF que no es factura.

### Compilado

```
npm run build
WEB_DIR=../web/dist npm start
```

Todo sale por el puerto 3001. La ruta de `WEB_DIR` se resuelve desde `apps/api`, que es donde se ejecuta el script `start`.

### Docker Compose

```
cp .env.example .env     # cambia INGEST_TOKEN y N8N_ENCRYPTION_KEY
docker compose up -d
```

La app queda en http://localhost:3001 y n8n en http://localhost:5678. Los archivos Docker no están probados en una máquina con Docker, así que si algo falla es lo primero que hay que mirar.

## Variables de entorno

| Variable | Para qué sirve | Por defecto |
|---|---|---|
| PORT | Puerto de la API | 3001 |
| DATA_DIR | Carpeta de la base de datos y los PDF | ./data |
| TZ_NEGOCIO | Zona horaria con la que se calcula "hoy" y "esta semana" | Europe/Madrid |
| INGEST_TOKEN | Token que n8n manda en la cabecera `x-ingest-token` | cambia-este-token |
| WEB_DIR | Carpeta de la web compilada, si la API debe servirla | vacío |
| ANTHROPIC_API_KEY | Activa el modo con modelo | vacío |
| ANTHROPIC_MODEL | Modelo que se usa en ese modo | claude-sonnet-5-5 |

Cambia `INGEST_TOKEN` antes de exponer la API fuera de tu máquina. La interfaz no tiene login.

## Flujo de n8n

1. En n8n, importa `n8n/flujo-facturas.json` (menú de los tres puntos, Import from file).
2. Crea una credencial IMAP con el buzón de facturas y asígnala al nodo "Correo entrante".
3. Define las variables `API_URL` (por ejemplo http://api:3001) e `INGEST_TOKEN`. El docker-compose ya las pasa.
4. Activa el flujo.

El flujo tiene cuatro pasos. "Correo entrante" lee los mensajes sin leer con sus adjuntos. "Separar adjuntos PDF" emite un elemento por cada PDF y descarta lo demás. "Enviar a la API" hace un POST multipart a `/api/ingest` con tres reintentos. "Duplicada?" distingue las facturas ya recibidas (la API responde `duplicate: true` si el SHA-256 del PDF ya existe). Si el envío falla tras los reintentos, el elemento sale por una rama de error con un nodo de aviso por correo que viene deshabilitado y hay que configurarlo con credenciales SMTP.

El flujo se ha importado en una instancia de n8n por línea de comandos para comprobar que el JSON es válido, pero no se ha ejecutado contra un buzón real.

## Cómo funciona la extracción

Por defecto el lector trabaja por reglas. Lee el PDF con `unpdf`, reconstruye líneas y celdas a partir de las posiciones del texto y busca etiquetas habituales en facturas españolas (número, fecha, NIF, base, IVA, IRPF, total), tablas de líneas por el nombre de sus columnas y tablas de impuestos. Después comprueba que las cifras cuadran (suma de líneas, base más impuestos igual al total) y guarda los desajustes como avisos que se ven en la lista y en el detalle.

Toda factura entra como "pendiente de revisar". Hay que validarla a mano desde el detalle. Una factura validada queda bloqueada hasta que se reabre.

## Modo con modelo

Si defines `ANTHROPIC_API_KEY`, la extracción pasa por el modelo y, si falla o devuelve datos que no encajan con el esquema, se vuelve al lector por reglas. El asistente también pasa a usar el modelo con herramientas que consultan la base de datos. Este modo solo se ha probado con tests que simulan la respuesta de la API, no contra el servicio real, y tiene coste por uso.

## Asistente y voz

Entiende preguntas sobre número de facturas, existencia con filtros (importe, proveedor), total facturado, proveedores, factura de mayor importe, resumen del día y pendientes de revisión, para los periodos hoy, ayer, esta semana, este mes y todo. Las facturas rechazadas no cuentan en las cifras.

La voz usa la Web Speech API del navegador: reconocimiento en es-ES para dictar la pregunta y síntesis para leer la respuesta. Funciona en Chrome, Edge y Safari, no en Firefox. No se ha probado el micrófono con un navegador real, solo el resto del flujo.

## Tests

```
npm test
npm run typecheck
```

Hay 50 tests (vitest y supertest) sobre utilidades, extracción con las muestras, cálculo de periodos, asistente, API y modo con modelo.

## Limitaciones conocidas

- El lector por reglas está ajustado a diseños de factura habituales. Con tablas de celdas vacías o formatos poco comunes puede dejar campos en blanco o avisar de descuadres.
- No hay OCR. Un PDF escaneado (imagen) se guarda con avisos y sin datos.
- Un PDF que no es una factura entra igualmente como pendiente, con avisos, y cuenta en las estadísticas hasta que se rechaza.
- La interfaz no tiene autenticación.
- SQLite en un fichero local es suficiente para este alcance, pero no para varias instancias de la API.
