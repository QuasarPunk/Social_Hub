# Servicio interno de Telegram

El nodo HTTP Request envía el teclado al servicio `telegram-relay` por la red privada de Compose. El servicio verifica la credencial interna y la lista de chats antes de llamar a `sendMessage` en Telegram. El contenedor del servicio tiene salida a Internet y carece de puertos publicados. La API oficial requiere el token en la ruta de la solicitud HTTPS saliente. Esa URL se construye dentro del servicio y se omite de las respuestas y los registros. [Telegram Bot API](https://core.telegram.org/bots/api#making-requests) · [Secretos de Compose](https://docs.docker.com/compose/how-tos/use-secrets/)

El relay de desarrollo puede recibir `callback_query` por long polling y responder con `answerCallbackQuery`. El receptor se habilita explícitamente y verifica que el token corresponda a `@Test_Social_Hub_bot` antes de consultar actualizaciones. [Telegram Bot API](https://core.telegram.org/bots/api#callbackquery)

## Contrato HTTP

`POST http://telegram-relay:8080/sendMessage` con `Content-Type: application/json` y `Authorization: Bearer <clave interna>`. Ejemplo con un chat ficticio:

```json
{
  "chat_id": 123456789,
  "text": "Seleccioná un proyecto",
  "reply_markup": {
    "inline_keyboard": [
      [
        { "text": "Bitácora", "callback_data": "sh:tg-1000:bitacora" },
        { "text": "Lamat", "callback_data": "sh:tg-1000:lamat" }
      ]
    ]
  }
}
```

El servicio admite IDs numéricos enteros no nulos de hasta 52 bits significativos, incluidos los negativos, como números o cadenas decimales. Requiere texto plano de hasta 4096 caracteres, al menos un botón, hasta ocho por fila y hasta 100 en total. Cada etiqueta admite hasta 128 caracteres y cada `callback_data` ocupa entre 1 y 64 bytes UTF-8. El cuerpo completo tiene un límite de 64 KiB. Los campos adicionales se rechazan, incluidos los botones de URL y las opciones de formato. [sendMessage](https://core.telegram.org/bots/api#sendmessage) · [InlineKeyboardButton](https://core.telegram.org/bots/api#inlinekeyboardbutton)

El éxito devuelve HTTP 200 con `{"ok":true,"message_id":1}`. Los errores tienen la forma `{"ok":false,"error":"código"}`.

| HTTP | Causa |
| --- | --- |
| 400 | JSON o mensaje inválido |
| 401 | Credencial interna ausente o incorrecta |
| 403 | Chat fuera de la lista |
| 404 / 405 | Ruta u operación HTTP fuera del contrato |
| 413 / 415 | Cuerpo demasiado grande o tipo de contenido incorrecto |
| 502 | Error HTTP, rechazo, respuesta inválida o fallo de conexión con Telegram |
| 504 | Telegram supera los 5 segundos disponibles para conexión y respuesta |

Ante un timeout, verificá el chat antes de volver a ejecutar. Telegram pudo aceptar el mensaje antes de que venciera el plazo. El servicio y el workflow hacen un solo intento por ejecución.

## Verificación aislada

Ejecutá `node --test tests/*.test.cjs` con Node.js 22. Para verificar también la importación y ejecución en n8n **2.48.6** con HTTP Request **4.5**, usá una imagen local de esa versión. El contenedor temporal ejecuta el borrador con una credencial ficticia, una base efímera y un Telegram simulado. [Versiones del nodo HTTP Request en n8n 2.48.6](https://github.com/n8n-io/n8n/blob/n8n%402.48.6/packages/nodes-base/nodes/HttpRequest/HttpRequest.node.ts)

```powershell
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("social-hub-relay-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path "$testRoot/tests", "$testRoot/workflows", "$testRoot/services/telegram-relay" | Out-Null
Copy-Item -LiteralPath tests/n8n-telegram-relay-smoke.cjs -Destination "$testRoot/tests/"
Copy-Item -LiteralPath workflows/SH-01-telegram-servicio-prueba.json -Destination "$testRoot/workflows/"
Copy-Item -LiteralPath services/telegram-relay/server.cjs -Destination "$testRoot/services/telegram-relay/"
$testImage = 'docker.n8n.io/n8nio/n8n:2.48.6'
docker run --rm --init --pull never --network none --mount "type=bind,source=$testRoot,target=/test,readonly" --entrypoint node $testImage /test/tests/n8n-telegram-relay-smoke.cjs
```

Si la imagen ya está descargada con otro tag, asigná ese tag o su ID a `$testImage`. El script verifica la versión y compara los tres botones recibidos con la entrada ficticia.

## Instalación y prueba real con autorización humana

Desde la raíz del repositorio, `node scripts/prepare-telegram-dev.cjs --check` valida los archivos ignorados y la configuración de Compose. Sin `--check`, inicia el proyecto de desarrollo, comprueba n8n y el relay, e importa un borrador manual y su credencial Header Auth. Para importar, el archivo `allowed-chats` debe tener un único destino distinto. El script actualiza el mismo borrador y la misma credencial en cada ejecución. La prueba real requiere autorización antes de ejecutar el borrador.

1. Autorizá el uso de un bot y un chat de prueba dedicados, la salida HTTPS a `api.telegram.org` y el envío de un mensaje de prueba. Iniciá la conversación con el bot desde el chat autorizado si es un chat privado. Usá el entorno independiente de los siguientes pasos.
2. Creá `secrets/telegram-dev/` con permisos de acceso restringidos en el host. Con un editor local, guardá tres archivos UTF-8 sin BOM. Verificá que Docker pueda montar los archivos y que el usuario `node` pueda leerlos dentro del contenedor.
   - `bot-token` contiene el token del bot de prueba.
   - `relay-key` contiene 32 bytes aleatorios en hexadecimal minúsculo (64 caracteres), generados con un gestor de secretos o un generador criptográfico.
   - `allowed-chats` contiene el ID decimal del chat autorizado, uno por línea si hay varios.
3. Arrancá el proyecto de prueba. El comando construye el servicio y puede descargar imágenes base. La interfaz de n8n queda en `http://localhost:5680` con su propia base y cuenta local.

   ```powershell
   docker compose --env-file .env.example -p social-hub-telegram-dev -f compose.telegram-dev.yml config --quiet
   docker compose --env-file .env.example -p social-hub-telegram-dev -f compose.telegram-dev.yml up -d --build
   docker compose --env-file .env.example -p social-hub-telegram-dev -f compose.telegram-dev.yml ps
   ```

4. Importá [SH-01 de prueba](../workflows/SH-01-telegram-servicio-prueba.json) como borrador. En **Enviar seleccion de proyecto**, asigná una credencial **Header Auth** nueva con nombre de cabecera `Authorization` y valor `Bearer ` seguido de la clave interna. Guardá el valor únicamente en la credencial de n8n. La URL interna, la expresión JSON y los límites de tiempo ya están configurados. [Credenciales de HTTP Request](https://docs.n8n.io/integrations/builtin/credentials/httprequest/)
5. En **Simular clasificacion pendiente**, reemplazá solamente el `chat_id` ficticio por el ID autorizado. Ejecutá **Prueba manual** una vez. Verificá `ok: true`, el `message_id` devuelto y las tres filas visibles en el chat. Registrá el resultado sin incluir el chat, las claves ni datos de ejecución.
6. Detené el proyecto con `docker compose --env-file .env.example -p social-hub-telegram-dev -f compose.telegram-dev.yml down`. La base local queda disponible para la próxima prueba.

La conexión del nodo con el SH-01 operativo, los cambios de webhooks y cualquier publicación son acciones posteriores con autorización propia. En un borrador aprobado de SH-01, el nodo se conecta a la salida de **Preparar botones de proyectos**, que ya entrega `chat_id`, `message` y `reply_markup`.

## Verificar la selección desde los botones

Desde PowerShell en la raíz del repositorio, corré primero la suite con Telegram simulado. El test nuevo entrega actualizaciones ficticias al mismo receptor que usa el relay y comprueba su llegada, la respuesta y el registro persistido.

```powershell
node --test tests/*.test.cjs
```

Prepará sólo el relay y el registro de desarrollo con la recepción deshabilitada. El registro `tg-1000` corresponde al teclado de la primera prueba y se crea una sola vez. Si ya existe, la siembra falla y conserva la elección previa.

```powershell
$telegramDevCompose = @('--env-file', '.env.example', '-p', 'social-hub-telegram-dev', '-f', 'compose.telegram-dev.yml')
$env:TELEGRAM_DEV_CALLBACKS = '0'
docker compose @telegramDevCompose config --quiet
docker compose @telegramDevCompose up -d --no-deps --build telegram-relay
docker compose @telegramDevCompose exec -T telegram-relay node /app/server.cjs --seed-dev-record
```

Para una prueba real autorizada, mantené un solo receptor del bot de desarrollo. Si el bot tiene un webhook activo u otro consumidor de `getUpdates`, resolvé ese conflicto antes de pulsar el botón. Estos comandos no registran ni eliminan webhooks. [Telegram getUpdates](https://core.telegram.org/bots/api#getupdates)

```powershell
$env:TELEGRAM_DEV_CALLBACKS = '1'
docker compose @telegramDevCompose up -d --no-deps telegram-relay
docker compose @telegramDevCompose logs --tail 20 -f telegram-relay
```

Esperá la línea `Recepción de callback_query activa`. Al pulsar un botón del mensaje que ya recibiste, `callback_query recibida` confirma la llegada al relay y `answerCallbackQuery aceptada` confirma la respuesta de Telegram. En el cliente aparece un aviso como **Clasificado en QuasarPunk** y se quita el indicador de espera. Podés salir de los logs con Ctrl+C y consultar sólo el estado y el proyecto, sin mostrar el registro completo.

```powershell
docker compose @telegramDevCompose exec -T telegram-relay node -p "const record = require('/data/records/tg-1000.json'); JSON.stringify({status:record.status,project_id:record.project_id})"
$env:TELEGRAM_DEV_CALLBACKS = '0'
docker compose @telegramDevCompose up -d --no-deps telegram-relay
Remove-Item Env:TELEGRAM_DEV_CALLBACKS
```

El resultado esperado es `CLASSIFIED` con el `project_id` seleccionado. Una pulsación posterior conserva la primera elección y muestra **Ya clasificado**. El aviso es temporal y los botones quedan visibles. Los registros se guardan en el volumen de desarrollo `telegram_records` y los perfiles se leen desde el montaje de sólo lectura al iniciar el relay.
