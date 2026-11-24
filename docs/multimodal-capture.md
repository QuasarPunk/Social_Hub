# Etapa 4.1 · Captura multimodal

## Flujo y almacenamiento

Telegram Relay sigue siendo el consumidor único. Los mensajes pasan por SH-01 y SH-02 de n8n 2.48.6 y llegan a `POST /classify` con Header Auth. En modo multimodal esa ruta admite los materiales o comandos en la sesión. El worker del relay cierra las capturas, descarga los medios, transcribe y llama a la misma clasificación editorial de la Etapa 4. El relay envía la confirmación de clasificación o el teclado de proyectos. SH-01 y SH-02 mantienen sus JSON y versiones de nodos. [Circuito editorial](editorial-classification.md)

La captura automática agrupa materiales consecutivos por chat y usuario. Utiliza la hora de admisión, una ventana reiniciable de 90 segundos y un máximo de 10 minutos desde el primer material. Cada elemento de un álbum conserva su `album_id` y cuenta como material nuevo. El máximo automático sigue aplicando al álbum. Usá `/nuevo` antes de adjuntar material si querés mantener la sesión abierta mientras grabás una nota larga.

| Comando | Resultado |
| --- | --- |
| `/nuevo` | Abre una sesión explícita o convierte la actual. Queda abierta hasta `/listo` o `/cancelar`. |
| `/listo` | Cierra la captura actual. Si no hay una abierta, reintenta la captura fallida más reciente. |
| `/cancelar` | Cancela la captura abierta. Sus metadatos se conservan y sus medios no se descargan ni se envían al clasificador. |

Cada actor tiene un diario JSON con cambios atómicos. La identidad del mensaje en ese actor permite reconocer una repetición aunque cambie el identificador de actualización. Se confirma el primer material y los comandos, sin responder a cada elemento del álbum. Solo una instancia del relay puede escribir en estos volúmenes. Al reiniciar se revisan los vencimientos y se retoma el trabajo sellado. Si un envío fue aceptado por Telegram justo antes de una desconexión, puede aparecer una confirmación o un teclado repetido. El resultado sigue siendo único.

Los binarios se guardan con nombres generados en `/files/incoming/`. Las fotos conservan los metadatos de las variantes de Telegram y el archivo de mayor tamaño recibido. Se admiten notas de voz, audio y documentos con tipo MIME o extensión de audio compatible. Se conserva el nombre, tipo, duración y demás metadatos disponibles. El límite por archivo es 20 MiB. Una captura sellada descarga los materiales antes de transcribir. Se reintenta hasta tres veces con pausas crecientes, y se conservan los medios descargados y las transcripciones exitosas. Si persiste el error, queda `FAILED` y el operador puede reintentar con `/listo`. Una transcripción vacía deja el audio pendiente de resolución.

## Contrato de captura 1.0

El resultado se escribe en `/files/records/mm-<id>.json`. Los registros de la Etapa 4 mantienen su forma y sus rutas. El nuevo registro conserva los campos editoriales `classification_contract_version: "1.0"`, `status`, `project_id`, `profile_version`, `editorial_profile` y `target_platforms` cuando corresponde. Los lectores pueden distinguir `type: "multimodal"` y `capture_contract_version: "1.0"`.

| Campo | Contenido |
| --- | --- |
| `instruction` | Textos y pies de foto en orden de recepción, seguidos por las transcripciones disponibles. Se clasifica el conjunto desde el catálogo editorial vigente. |
| `capture.mode`, `capture.closed_at` | Modo automático o explícito y fecha UTC de cierre. |
| `capture.materials[]` | Materiales ordenados con tipo `text`, `photo`, `voice` o `audio`, sus metadatos originales, identificación de álbum cuando corresponda, y ruta local para binarios. |
| `capture.materials[].transcription` | Texto, idioma, proveedor y modelo cuando el proveedor lo informa. |
| `user_id`, `chat_id` | Asociación interna de autor y chat. Solo ese autor puede resolver el teclado de la captura. |

Para SH-03, `capture.materials` será la fuente de los medios de un registro multimodal. `media_path` conserva la ruta de la primera fotografía o `null`. La Etapa 5 permanece pendiente.

## Transcripción local

El proveedor de desarrollo es faster-whisper 1.2.1, en CPU con `int8`, idioma español y modelo multilingüe `small`. PyAV 15.1.0 decodifica Ogg/Opus y los demás formatos que reconoce su versión de FFmpeg. Esa versión queda fijada porque la API de PyAV 19 no es compatible con el decodificador de faster-whisper 1.2.1.

El equipo probado tiene Ryzen 5 4600G de 6 núcleos y 12 hilos, Radeon integrada y 7,46 GiB disponibles para Docker. Con cuatro hilos, `small` transcribió una muestra sintética en español de 6,99 segundos de Ogg/Opus en 6,0 segundos. El contenedor usó unos 457 MiB de RAM después de esa inferencia. Reservá unos 484 MB para el archivo del modelo y 737 MB para la imagen. `base` ocupa alrededor de 145 MB y sirve como alternativa de menor huella. En la muestra, `small` conservó mejor la frase que `base`, aunque ambos cometieron errores con el nombre propio. Una muestra breve no establece la latencia ni la calidad de notas reales más largas. [faster-whisper](https://github.com/SYSTRAN/faster-whisper)

`whisper.cpp` admite CPU y modelos cuantizados, y queda como alternativa si se busca un motor más pequeño. Sería necesario un adaptador para el mismo contrato HTTP. El servicio configurable recibe `POST /transcribe` con `application/octet-stream` y responde con `{"text":"…","model":"…"}`. Las respuestas deben representar una transcripción auténtica. El proveedor de desarrollo procesa sin salida a Internet tras descargar el modelo. [whisper.cpp](https://github.com/ggml-org/whisper.cpp)

## Instalación y prueba en desarrollo

Prepará los secretos, el catálogo y los borradores de n8n según la guía de la Etapa 4. La lista de chats sigue siendo obligatoria. En chats privados el usuario debe coincidir con el chat salvo configuración explícita. Para probar grupos, configurá también `TELEGRAM_ALLOWED_USERS` con IDs de usuarios autorizados en una variable local que se mantenga fuera de Git. [Preparación del relay](editorial-classification.md#desarrollo-con-el-bot-de-pruebas)

```powershell
$dev = @('--env-file','.env.example','-p','social-hub-telegram-dev','-f','compose.telegram-dev.yml')
$env:TELEGRAM_MULTIMODAL = '1'
node scripts/prepare-telegram-dev.cjs --integrated
docker compose @dev --profile multimodal build transcriber
docker compose @dev --profile multimodal create transcriber
docker run --rm --mount "type=volume,source=social-hub-telegram-dev_whisper_models,target=/models" --entrypoint python social-hub-telegram-dev-transcriber -c "from faster_whisper.utils import download_model; download_model('small')"
docker compose @dev --profile multimodal up -d --no-deps transcriber
```

La descarga inicial del modelo necesita Internet. Para otro modelo multilingüe, configurá `WHISPER_MODEL` y descargá previamente el mismo modelo. `WHISPER_THREADS`, `TELEGRAM_TRANSCRIBE_URL`, `TELEGRAM_CAPTURE_IDLE_MS` y `TELEGRAM_CAPTURE_MAX_MS` son configurables. Conservá `TELEGRAM_DEV_CALLBACKS=0`. Publicá SH-02 antes de SH-01 y habilitá `TELEGRAM_POLLING=1` solo para la prueba real autorizada. Luego recreá el relay con polling deshabilitado.

Las pruebas usan un reloj controlado y doblajes de Telegram y transcripción. Ejecutá `node --test tests/*.test.cjs` y el smoke test aislado de n8n. [Integración aislada](editorial-classification.md#verificación-aislada)

## Despliegue futuro y reversión

La Etapa 4.1 se habilita en el entorno principal después de validar el bot de pruebas y de una autorización de despliegue. Al preparar ese corte, respaldá n8n, `records`, `incoming` y el volumen que se usará para `/data/sessions`. Montá el volumen de sesiones con permisos de escritura para el relay y el servicio de transcripción en una red interna. Cargá el modelo antes de habilitar `TELEGRAM_MULTIMODAL=1`. Conservá el consumidor único y los secretos propios del entorno.

Para revertir, recreá el relay con `TELEGRAM_MULTIMODAL=0`. Así se usa la entrada de texto y fotos de la Etapa 4, con el mismo consumidor. Conservá las sesiones, originales, transcripciones y registros para poder retomar el procesamiento o revisarlos. Deshabilitá primero el polling si además necesitás cambiar el consumidor de Telegram. [Reversión del consumidor](editorial-classification.md#procedimiento-de-despliegue-principal)
