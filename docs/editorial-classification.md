# Etapa 4 · Clasificación e identidad editorial

El relay consume `message` y `callback_query` en una sola sesión de long polling para cada bot. Comprueba el usuario del bot y la ausencia de un webhook antes de consultar actualizaciones. Si Telegram devuelve un conflicto de consumidor, detiene el receptor. SH-01 usa un webhook interno de n8n con Header Auth y no registra un webhook en Telegram.

```text
Mensaje → Telegram Relay → SH-01 → SH-02 → /classify del relay → registro
       ← confirmación o teclado según el resultado
Pulsación → mismo receptor → transición del mismo registro → answerCallbackQuery
```

El relay autoriza el chat, normaliza texto o fotografía, descarga la foto de mayor tamaño que proporciona Telegram y persiste el archivo antes de escribir el registro. Las confirmaciones y los teclados salen del relay. Las copias integradas se verificaron con n8n **2.48.6**, Webhook **2.1**, Code **2**, Execute Sub-workflow **1.4**, Execute Sub-workflow Trigger **1.3** y HTTP Request **4.5**.

## Esquema y alta de perfiles

Cada perfil activo vive en `projects/<project_id>/profile.json`. La plantilla inactiva está en `projects/_templates`. El directorio se monta como solo lectura en el relay. Para agregar un proyecto, copiá la plantilla a un directorio con el identificador, completá el perfil, marcá `active: true` y recreá el relay. El catálogo se valida al iniciar y se usa en ambas rutas. Ningún workflow contiene una lista de proyectos.

| Campo | Regla |
| --- | --- |
| `schema_version` | Versión de la estructura JSON. El prototipo admite `"1.0"`. |
| `profile_version` | Entero positivo que identifica la revisión editorial. Comienza en 1 y aumenta con cada cambio editorial del perfil. |
| `project_id` | Identificador estable igual al nombre del directorio. De 1 a 35 caracteres ASCII en minúsculas, dígitos, guiones o guiones bajos. Comienza con una letra o dígito. |
| `name`, `aliases`, `active` | Nombre visible de hasta 128 caracteres, lista de alias y bandera booleana de activación. El catálogo admite de 1 a 100 perfiles activos. |
| `identity`, `audience`, `communication`, `editorial` | Descripciones de identidad y audiencia, idioma, tono, temas y restricciones. La plantilla incluye campos adicionales para estilo, instrucciones y preferencias. |
| `platforms` | Mapa de canales con `enabled` booleano. Las credenciales se gestionan fuera del perfil. |

Un identificador exacto antes de dos puntos tiene prioridad. Después se buscan nombres o alias en el prefijo y, si no coinciden, en la instrucción completa. Las comparaciones ignoran mayúsculas, tildes y espacios repetidos, y respetan los límites de palabra. Varios candidatos producen un teclado con esos proyectos. Si no hay coincidencias, aparecen todos los perfiles activos. Los botones vinculan contenido y proyecto con `sh:<content_id>:<project_id>` y se validan contra el chat, el registro y las opciones ofrecidas.

## Contrato CLASSIFIED 1.0

SH-02 devuelve el registro automático completo a SH-01. La selección manual publica el mismo contrato en el JSON persistido. El futuro SH-03 puede consumir los registros con `status: "CLASSIFIED"` y `classification_contract_version: "1.0"` desde `/files/records/<content_id>.json`. La fotografía, cuando existe, está disponible mediante el montaje `/files/incoming`.

| Campo | Significado |
| --- | --- |
| `content_id`, `source`, `type`, `instruction`, `received_at` | Identificador estable del contenido, origen, tipo `text` o `photo`, texto o pie de foto e instante UTC de recepción. |
| `media_path` | Ruta de la fotografía o `null` para texto. |
| `status`, `classification_contract_version` | `CLASSIFIED` y `"1.0"`. |
| `project_id`, `profile_version`, `editorial_profile` | Proyecto, revisión editorial y copia del perfil aplicado. `project` conserva el identificador para lectores anteriores. |
| `target_platforms` | Lista de canales habilitados en esa revisión. |
| `classification` | Resultado `IDENTIFIED`, método `explicit_prefix`, `alias_match` o `telegram_selection`, candidatos originales y fecha UTC de clasificación. |
| `clarification.required`, `updated_at` | `false` y fecha UTC de la transición. |

El registro también guarda metadatos de Telegram necesarios para vincular el mensaje y reconocer reintentos. Para contenido pendiente se registra el resultado `AMBIGUOUS` o `UNIDENTIFIED` y las opciones ofrecidas. Si una opción deja de estar activa antes de pulsarla, la selección se rechaza. Si el perfil sigue activo, se guarda la revisión cargada al momento de resolver la selección.

El relay es el único escritor durante el despliegue integrado. Crea el registro sin sobrescritura y actualiza mediante reemplazo atómico. El reenvío del mismo mensaje conserva sus bytes tras confirmar la respuesta por Telegram. La primera selección válida deja el registro terminal y una segunda consulta recibe «Ya clasificado». Si Telegram acepta un envío justo antes de un corte o timeout, puede aparecer otro teclado para el mismo registro. El ID y la transición son idempotentes incluso con ambos teclados. Un fallo persistente antes de confirmar una actualización detiene el avance de esa cola hasta que se recupera el procesamiento.

Los registros existentes ya clasificados se conservan. Para consumirlos con el contrato nuevo sería necesaria una migración separada que determine sus revisiones históricas. Si se reentrega un mensaje legado en estado `RECEIVED`, el relay clasifica su registro existente. Los registros pendientes anteriores pueden resolverse si su teclado llega al relay y la opción sigue activa.

## Verificación aislada

Desde PowerShell en la raíz, con Docker disponible e imagen local de n8n 2.48.6:

```powershell
node --test tests/*.test.cjs
$root = (Get-Location).Path
docker run --rm --init --pull never --network none `
  --mount "type=bind,source=$root/tests/n8n-editorial-smoke.cjs,target=/test/tests/n8n-editorial-smoke.cjs,readonly" `
  --mount "type=bind,source=$root/workflows/SH-01-telegram-integrado.json,target=/test/workflows/SH-01-telegram-integrado.json,readonly" `
  --mount "type=bind,source=$root/workflows/SH-02-clasificacion-integrada.json,target=/test/workflows/SH-02-clasificacion-integrada.json,readonly" `
  --mount "type=bind,source=$root/services/telegram-relay,target=/test/services/telegram-relay,readonly" `
  --mount "type=bind,source=$root/projects,target=/test/projects,readonly" `
  --mount "type=bind,source=$root/scripts/telegram-workflows.cjs,target=/test/scripts/telegram-workflows.cjs,readonly" `
  --entrypoint node docker.n8n.io/n8nio/n8n:2.48.6 /test/tests/n8n-editorial-smoke.cjs
```

El smoke test importa y publica SH-02 y SH-01 dentro de una base efímera. Comprueba ambas fronteras Header Auth, ejecuta los workflows con actualizaciones ficticias, valida el cuerpo enviado a Telegram y reinicia n8n y el relay sobre el mismo almacenamiento de prueba. Telegram simulado también verifica la descarga de foto, los callbacks, el rechazo de otro consumidor y los proyectos activos.

| Criterios de README | Evidencia |
| --- | --- |
| 1 y 2. Esquema versionado y perfiles de ejemplo | Los perfiles de QuasarPunk, Ecoaldea Lamat y Bitácora usan el mismo esquema. Las tres rutas automáticas guardan revisión y perfil. |
| 3 y 4. Catálogo validado y montaje de solo lectura | El relay valida los JSON activos al iniciar. Compose monta `./projects:/projects:ro`. |
| 5. Identificación y selección vinculada | Se verifican identificador, alias con tildes, ambigüedad, ausencia de coincidencias, foto, chat ajeno y opciones inválidas. |
| 6. Identificador, revisión y contexto editorial | Se compara el contrato automático con el manual. El registro y la fotografía sobreviven a un reinicio. Una segunda selección conserva la primera. |
| 7. Alta sin editar workflows | Bitácora funciona en el catálogo existente. El smoke test incorpora un cuarto perfil ficticio, Orión, y lo usa por alias y como opción del teclado. |
| 8. Esquema y pruebas documentados | Esta guía registra el contrato, las versiones, las pruebas y el corte. |

## Desarrollo con el bot de pruebas

`node scripts/prepare-telegram-dev.cjs --integrated` reconstruye el relay con el receptor deshabilitado e importa dos borradores con la credencial interna, usando los secretos y volúmenes exclusivos de desarrollo. Usalo antes de publicar y evitá reimportar sobre versiones publicadas. Para una prueba real autorizada, publicá primero SH-02 y luego SH-01, verificá que el bot de pruebas esté libre de webhooks y de otro consumidor, y recreá solo el relay con `TELEGRAM_POLLING=1` y `TELEGRAM_DEV_CALLBACKS=0`. Al terminar, recrealo con ambos valores en cero.

## Validación real en desarrollo

Se verificó el circuito completo con `@Test_Social_Hub_bot`, n8n **2.48.6** y los volúmenes exclusivos de desarrollo. La ruta interna rechazó la solicitud sin Header Auth y ejecutó SH-01 y SH-02 con la credencial. El relay confirmó la identidad del bot, la ausencia de webhook activo y una consulta de actualizaciones exitosa sin conflicto.

| Caso real | Resultado |
| --- | --- |
| Texto con identificador de QuasarPunk, Ecoaldea Lamat o Bitácora | `explicit_prefix` con el proyecto esperado en los tres registros. |
| Texto con el alias Radio Lamat | `alias_match` y `project_id: lamat`. |
| Texto sin coincidencias y texto con dos candidatos | El primero ofreció el catálogo activo. El segundo quedó en `AMBIGUOUS` y ofreció solo QuasarPunk y Ecoaldea Lamat. En ambos teclados se guardó la primera elección y Telegram aceptó las respuestas a los callbacks. Los registros quedaron idénticos tras las segundas selecciones. |
| Fotografía con descripción | Se clasificó en QuasarPunk. n8n leyó el mismo JPEG y el mismo JSON desde sus montajes de solo lectura. |

Los siete registros finales tuvieron las mismas claves del contrato `CLASSIFIED` 1.0, `profile_version: 1`, una copia exacta del perfil y las plataformas habilitadas correspondientes. Los ensayos aislados aportan la cobertura de altas de perfiles, configuración inválida y selección fuera de las opciones ofrecidas. En conjunto, la evidencia cubre los ocho criterios de la Etapa 4 del README.

Al cerrar la sesión se recreó el relay con el polling deshabilitado y se retiraron las publicaciones temporales de SH-01 y SH-02. Los siete registros y el JPEG conservaron su contenido después de recrear el contenedor.

## Despliegue principal pendiente

1. Con autorización de corte, respaldá `n8n_data`, la clave de cifrado, los workflows y `storage`. Confirmá que la instancia principal usa n8n 2.48.6. Si usa otra versión, validá la cadena con esa versión antes de recrear n8n. Verificá que el usuario de los contenedores pueda leer los secretos, leer y escribir en `storage/records` y `storage/incoming` y hacer enlaces duros y reemplazos dentro de esos directorios.
2. Configurá los tres secretos de Compose bajo `secrets/telegram-main/` y `TELEGRAM_EXPECTED_BOT` con el nombre de usuario del bot principal, sin arroba. Validá ambos archivos de Compose con `docker compose -f docker-compose.yml -f compose.telegram-main.yml config --quiet`. Levantá con esos mismos archivos y `up -d --build`, manteniendo `TELEGRAM_POLLING=0`. El overlay reutiliza los directorios existentes.
3. Importá SH-02 y SH-01 integrados a la misma instancia. En SH-01 vinculá el nodo **Ejecutar SH-02 y devolver registro** al nuevo SH-02. En el Webhook de SH-01 y el HTTP Request de SH-02 asigná la credencial **Header Auth** con cabecera `Authorization` y valor `Bearer <relay-key>`. La clave queda en el gestor de credenciales de n8n y en el secreto del relay.
4. Publicá el nuevo SH-02. Despublicá el SH-01 anterior y detené el túnel cuando deje de ser necesario. Verificá que el bot no tenga webhook activo ni otro consumidor. Publicá el nuevo SH-01 interno. Mantené una sola réplica del relay, habilitá `TELEGRAM_POLLING=1` y recreá únicamente `telegram-relay` con el overlay. Esperá la confirmación de recepción y ejecutá la prueba de corte autorizada.
5. Si hay que revertir, deshabilitá el polling y detené el relay antes de reactivar el consumidor anterior. Despublicá el SH-01 integrado y luego su SH-02. Restaurá la configuración anterior de n8n y su túnel. Conservá los registros y fotos creados durante el corte.
