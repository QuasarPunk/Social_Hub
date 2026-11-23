# Desarrollo asistido de Social Hub

## Ciclo de trabajo

1. Creá una rama y registrá la versión con `docker exec social-hub-n8n n8n --version`. La prueba usa n8n **2.48.6** y Telegram **1.2**.
2. Conservá los originales. Para versionar una copia, excluí referencias a credenciales, IDs de instancia, webhooks, datos fijados, URLs y chats reales. Revisá también expresiones, notas y datos de ejemplo.
3. Ejecutá `node --test tests/*.test.cjs` con Node.js 22. Revisá el diff y verificá la importación en una instancia aislada.
4. Incluí en la revisión de Git la versión, los resultados y los pendientes. La promoción a producción se decide por separado.

## Importar y comprobar el teclado

La [copia de SH-01](../workflows/SH-01-telegram-teclado-prueba.json) incluye una rama manual que simula la respuesta de SH-02 y evita las operaciones de archivos. El Telegram Trigger está deshabilitado y el vínculo con SH-02 queda sin asignar. La expresión completa de `inlineKeyboard` viene en el JSON.

**Resultado en n8n 2.48.6.** Las pruebas de Node.js confirman que la expresión genera las filas esperadas. En un contenedor sin acceso a red externa, la CLI conservó la expresión al importar y reexportar. Al ejecutar, el servidor simulado recibió `reply_markup: { inline_keyboard: [] }`. La normalización de parámetros de n8n devuelve `{}` para esa expresión cuando aplica los valores por defecto de la colección. Por eso hay que verificar el cuerpo saliente, además de revisar el JSON exportado. La copia sirve para reproducir el fallo y verificar futuras versiones. [Normalización de colecciones en n8n 2.48.6](https://github.com/n8n-io/n8n/blob/n8n%402.48.6/packages/workflow/src/node-helpers.ts#L948-L999)

1. En PowerShell, prepará un directorio temporal con los archivos de prueba. El contenedor usa la imagen local y su propia base temporal, aislada del volumen activo.

   ```powershell
   $testRoot = Join-Path ([IO.Path]::GetTempPath()) ("social-hub-keyboard-" + [guid]::NewGuid())
   New-Item -ItemType Directory -Path "$testRoot/tests", "$testRoot/workflows" | Out-Null
   Copy-Item -LiteralPath tests/telegram-mock.cjs -Destination "$testRoot/tests/"
   Copy-Item -LiteralPath workflows/SH-01-telegram-teclado-prueba.json -Destination "$testRoot/workflows/"
   $testImage = docker inspect --format '{{.Image}}' social-hub-n8n
   docker run --init --rm --name social-hub-keyboard-test -p 127.0.0.1:5680:5678 --mount "type=bind,source=$testRoot,target=/test,readonly" -e N8N_SECURE_COOKIE=false -e N8N_DIAGNOSTICS_ENABLED=false --entrypoint sh $testImage -c 'node /test/tests/telegram-mock.cjs & exec n8n start'
   ```

2. Abrí `http://localhost:5680`, completá la configuración local y creá un workflow vacío. Usá **Import from File** con la copia de SH-01. Dejalo como borrador con el Telegram Trigger deshabilitado.
3. En `Enviar seleccion de proyecto`, asigná una credencial Telegram API de prueba con el token ficticio `123456:TEST_ONLY_NOT_A_TELEGRAM_TOKEN` y la base `http://127.0.0.1:18765`. Verificá la base antes de guardar. El simulador del mismo contenedor responde a `getMe` y `sendMessage`.
4. Guardá y reabrí el borrador. Reexportalo y comprobá que `replyMarkup` siga siendo `inlineKeyboard` y que `inlineKeyboard` conserve la expresión completa. Ejecutá desde `Prueba manual`. El criterio de éxito es que el simulador imprima `sendMessage verificado con los tres botones ficticios` y devuelva `message_id: 1`. En 2.48.6, la prueba por CLI capturó un teclado vacío, que este simulador rechaza con 400.
5. Detené el contenedor de prueba con Ctrl+C. Para una futura prueba de clasificación, usá una copia saneada de SH-02, registros ficticios y un directorio separado. Una prueba visual requiere autorización, un bot y un chat dedicados. Para probar pulsaciones hace falta implementar `callback_query` y validar la selección antes de modificar registros.

## CLI y API en esta instalación

Se comprobaron `n8n --version`, `n8n import:workflow --help` y `n8n export:workflow --help`. El importador recibe `--input` y tiene `--activeState=false` por defecto. Un JSON con ID puede afectar un workflow existente. Reservá el importador de servidor para la base aislada. Para exportar un borrador concreto, usá `export:workflow --id <ID> --pretty --output <archivo>`. Agregá `--published` cuando necesites comparar esa versión. Guardá el archivo crudo fuera del conjunto a versionar. [CLI de servidor](https://docs.n8n.io/hosting/cli-commands/)

El `GET` sin clave a `http://127.0.0.1:5678/api/v1/workflows` respondió **401**. La API usa la cabecera `X-N8N-API-KEY` y documenta operaciones de lista, lectura, creación y actualización. La disponibilidad autenticada queda pendiente de comprobar con una clave de desarrollo. [Autenticación y scopes](https://docs.n8n.io/api/authentication/)

## Envío por el servicio interno

En n8n 2.48.6, una expresión de `reply_markup` en `additionalFields` con `replyMarkup` en `none` también produjo un teclado vacío con el nodo nativo. El [borrador para el servicio interno](../workflows/SH-01-telegram-servicio-prueba.json) reutiliza `Preparar botones de proyectos` y pasa el objeto a HTTP Request 4.5. La [guía del servicio](telegram-relay.md) describe la ejecución aislada, la credencial interna y la prueba de envío con autorización.

En la ejecución aislada con n8n 2.48.6 y HTTP Request 4.5, el simulador recibió las tres filas esperadas y n8n devolvió `message_id: 1`. La prueba real con Telegram queda pendiente de autorización.

## Propuesta de sincronización

- **Git a desarrollo.** Ejecutar las pruebas y construir el cuerpo REST con `name`, `nodes`, `connections` y `settings`. Hacer `POST /api/v1/workflows` contra la instancia de desarrollo para crear el borrador y guardar su ID en configuración local. Vincular subworkflows y credenciales por entorno, fuera del JSON versionado.
- **Actualizaciones.** Recuperar `GET /api/v1/workflows/{id}`, verificar el destino y comparar el estado con la última versión sincronizada antes de hacer `PUT /api/v1/workflows/{id}`. Detenerse ante cambios hechos en el editor. Releer y comparar los campos funcionales después de guardar, incluida la expresión del teclado.
- **Desarrollo a Git.** Exportar con la CLI o un GET a un directorio temporal, sanear y generar un diff para revisión. Empezar con un script local invocado a demanda. Usar una clave de desarrollo con los scopes mínimos de lectura, creación y actualización, sin publicación, y cargarla desde un gestor local de secretos.
