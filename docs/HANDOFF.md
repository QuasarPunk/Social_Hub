# Traspaso de Social Hub 0.1

## Estado técnico

La Etapa 4.1 está desplegada con n8n 2.48.6. El relay es el único receptor de Telegram y procesa mensajes y callbacks. SH-01 recibe mensajes por una ruta interna con Header Auth y ejecuta SH-02. El relay conserva los originales, transcribe y clasifica con el catálogo de `projects/*/profile.json`. El contrato persistido es `CLASSIFIED` 1.0. [Arquitectura y contrato](editorial-classification.md)

- El entorno principal usa `docker-compose.yml` junto con `compose.telegram-main.yml`. Conserva su SQLite en el volumen de n8n y el material en `storage/records` y `storage/incoming`.
- El entorno de desarrollo usa `compose.telegram-dev.yml`, el proyecto Compose `social-hub-telegram-dev`, n8n en `127.0.0.1:5680` y sus propios volúmenes. Usá datos ficticios y mantené desactivado el polling real salvo durante una prueba autorizada.
- Las copias saneadas para desplegar están en `workflows/SH-01-telegram-integrado.json` y `workflows/SH-02-clasificacion-integrada.json`. El procedimiento de corte y reversión está documentado. [Despliegue principal](editorial-classification.md#procedimiento-de-despliegue-principal)

## Último hito y pendientes

- Pasaron la matriz de ocho criterios, la suite de regresión y la integración aislada. El bot de desarrollo comprobó texto, foto, clasificación por identificador y alias, teclados ambiguos e idempotencia.
- En el bot principal se verificaron la clasificación automática, la selección manual y la persistencia de una fotografía que n8n pudo leer. Los 25 registros y 5 archivos históricos conservaron sus bytes. La Etapa 4 quedó cerrada.
- La rama `dev/multimodal-capture` implementa la Etapa 4.1. La revisión de audios reales confirmó que los nombres deformados por la transcripción no coincidían con el catálogo anterior. La corrección usa alias de voz exactos y contexto de catálogo en el transcriptor. La Etapa 5 se cerró después con SH-03. [Diagnóstico y solución](multimodal-capture.md#clasificación-por-voz)
- El entorno principal ya ejecuta la Etapa 4.1 con el overlay multimodal y un único receptor. El respaldo local previo al corte se verificó con SHA-256 y una restauración de SQLite. Los 36 archivos históricos conservaron sus bytes. Pasaron 44 pruebas y el smoke test con n8n 2.48.6. [Procedimiento de despliegue y reversión](multimodal-capture.md#despliegue-futuro-y-reversión)
- La Etapa 4.1 quedó cerrada. El bot principal confirmó una captura real con foto y voz, transcripción local y clasificación en QuasarPunk con `transcript_match`. n8n leyó ambos originales y el registro con los mismos SHA-256. [Validación en producción](multimodal-capture.md#validación-en-producción)
- `dev/editorial-ai` incorpora SH-03, la corrección de la vista previa y la validación real confirmada en `@Test_Social_Hub_bot`. La incidencia de Instagram y Facebook quedó diagnosticada y resuelta. El cierre incluye commit y push de la rama e integración en `main`; SH-03 sigue sin desplegarse en producción. [Incidencia](#incidencia-sh-03-en-telegram)
- Pasaron 63 pruebas de Node.js, el smoke test aislado de SH-01, SH-02 y SH-03 con n8n 2.48.6 y la generación real con Qwen2.5 1.5B. El registro de la prueba real produjo un lote `DRAFT` con dos plataformas, un intento y cero errores; el proveedor fue Ollama con `qwen2.5:1.5b`, no el respaldo determinista. Los borradores respetaron `sin hashtags; sin emojis`. [Validación real](editorial-drafts.md#validación-real-confirmada)
- `dev/editorial-quality` completó la Etapa 5.1: prompt 2.1, perfiles versión 3 con notas narrativas, saneamiento de copias y comparación de tres modelos locales con capturas ficticias. `llama3.2:3b` conservó los tres hechos y todas las restricciones, con 160,4 s y 4,944 GiB en CPU. Pasaron 66 pruebas. La recomendación es para desarrollo; no hay despliegue ni aprobación de producción. [Evaluación](editorial-drafts.md#etapa-51-calidad-editorial)

## Problemas conocidos

### Indisponibilidad del entorno de desarrollo tras reiniciar Docker

Al retomar la misión, `docker compose ls` mostraba solo `social_hub` en ejecución. Los cuatro contenedores de `social-hub-telegram-dev` estaban `Exited (255)` con el mismo timestamp; producción tenía `restart: unless-stopped` y había vuelto sola. La causa fue la falta de política de reinicio en el Compose de desarrollo, no una pérdida de volúmenes ni un fallo de modelos.

Se levantaron n8n, Telegram Relay, el transcriptor y Ollama con los perfiles `multimodal` y `editorial-model`, sin `down -v`, sin `pull` de imágenes y sin `ollama pull`. Se conservaron los volúmenes `n8n_dev`, `telegram_records`, `telegram_incoming`, `telegram_sessions`, `whisper_models`, `editorial_models` y `editorial_drafts`. `ollama list` sigue mostrando `qwen2.5:1.5b` y `qwen3-vl:2b`. `/healthz` respondió 200 en 5678 y 5680; el transcriptor respondió 200 en la red interna.

`@Test_Social_Hub_bot` tiene un solo receptor de desarrollo. El relay principal usa `YourSocialHub_bot`, por lo que ambos pueden tener polling activo sin competir por el mismo bot. La secuencia exacta de arranque diario está en [el procedimiento de desarrollo](development-workflow.md#arranque-diario-de-los-entornos).

### Incidencia SH-03 en Telegram

El bot de desarrollo respondía «No se pudo preparar el borrador. Podés reintentar con /borrador.» a `/borrador instagram` y `/borrador facebook`. El registro más reciente del chat estaba en `CLASSIFIED` 1.0, con perfil 2 e Instagram y Facebook habilitados, y no existía un lote para esa captura. Ollama registraba `POST /api/chat` con HTTP 200; eso no probaba que el plan fuera válido.

**Diagnóstico.** Se instrumentó `editorial.request` con registro saneado de etapa, código y razón. Una única reproducción con el registro ficticio dio `code=invalid_provider_response reason=fragments_duplicate`, dos intentos y cero lotes escritos. El registro tenía un solo fragmento utilizable y el esquema ofrecía `maxItems: 5` para Facebook. Ollama 0.13.5 respetó `maxItems` pero ignoró `uniqueItems` y devolvió cinco IDs repetidos. El validador local rechazó la selección, el motor reintentó una vez y no persistió nada. `latest` eligió correctamente el registro más reciente; no hubo fallo de parseo, red ni credenciales. No se imprimió contenido ni respuesta cruda del modelo.

**Corrección.** El esquema declara `uniqueItems: true` y limita `maxItems` a los IDs disponibles. Si un proveedor repite IDs pese al esquema, el validador conserva el primero de cada uno y agrega `fragmentos_repetidos_omitidos` a `warnings`, sin introducir hechos nuevos. `editorial-preview.cjs` y `/drafts` registran `editorial.request stage=<preview|workflow> code=<código> reason=<razón>` desde listas permitidas. El resto de las violaciones del contrato siguen rechazándose sin persistir un lote. No se cambió el modelo ni se descargaron modelos nuevos. [Detalle técnico](editorial-drafts.md#incidencia-de-la-vista-previa-y-corrección)

**Verificación previa a la prueba humana.** Pasaron 63 pruebas de Node.js, el smoke test aislado de n8n 2.48.6 y una generación real con el registro que fallaba: un intento, `status=DRAFT`, dos plataformas, cero errores, cero advertencias, lote persistido y registro fuente idéntico. El endpoint autenticado de SH-03 en n8n de desarrollo devolvió el mismo lote reutilizado. El smoke test real con tres plataformas cumplió `sin hashtags; sin emojis`.

**Estado actual.** El operador completó la secuencia real en `@Test_Social_Hub_bot` con resultados satisfactorios. La inspección de volúmenes confirmó dos borradores del mismo lote, proveedor Ollama `qwen2.5:1.5b`, un intento, registro fuente conservado, cero errores editoriales y cero publicaciones automáticas. Quedó documentada la advertencia `foto_sin_interpretacion_visual` derivada de `EDITORIAL_VISION=0` en desarrollo. Con estos criterios se cierra SH-03 en `dev/editorial-ai` y se integra en `main`; la Etapa 5.1 se ejecutó después en `dev/editorial-quality`. [Evidencia](editorial-drafts.md#validación-real-confirmada)

- Si Telegram acepta un teclado justo antes de un timeout, un reintento puede mostrar otro teclado para el mismo registro. La primera selección válida se conserva.
- Los registros clasificados antes del contrato 1.0 conservan su formato y no tienen una revisión editorial histórica asignada por el sistema.
- Las exportaciones antiguas del historial incluyen metadatos privados. El árbol de trabajo usa copias saneadas. Consultá el informe técnico y mantené fuera de Git los secretos, datos reales y exportaciones crudas. [Revisión del historial](editorial-classification.md#revisión-del-historial)
- El endpoint de descarga de Telegram limita el archivo a 20 MiB. Una transcripción fallida conserva el audio y puede reintentarse con `/listo`. El worker procesa una captura sellada a la vez. Los diarios acumulan metadatos de deduplicación. [Diseño y operación](multimodal-capture.md)

## Verificación

Desde la raíz, en PowerShell con Node.js 22 y Docker disponible:

```powershell
node --test tests/*.test.cjs
$dev = @('--env-file','.env.example','-p','social-hub-telegram-dev','-f','compose.telegram-dev.yml','-f','compose.editorial-dev.yml','--profile','multimodal','--profile','editorial-model')
docker compose @dev config --quiet
docker compose @dev ps
node scripts/prepare-telegram-dev.cjs --integrated
```

El último comando prepara los borradores y la credencial interna de una instancia de desarrollo ya configurada. Usalo con los secretos de desarrollo y antes de publicar los workflows. Para probar sin credenciales ni red externa, ejecutá el smoke test de n8n con Telegram simulado. [Comando reproducible de integración](editorial-classification.md#verificación-aislada)

## Validación real de la Etapa 4.1

El despacho está en `services/telegram-relay/callbacks.cjs`, la sesión y el worker en `capture.cjs` y la clasificación común en `editorial.cjs`. SH-01 y SH-02 de n8n 2.48.6 mantuvieron sus JSON y versiones de nodos. La suite cubre los criterios de la tabla y el smoke test comprueba una captura de foto y voz a través de ambos workflows. [Preparación y reversión](multimodal-capture.md#instalación-y-prueba-en-desarrollo)

Pasaron 44 pruebas de Node.js y la integración de n8n. La relectura de tres notas reales dejó intactos los archivos y recuperó las dos coincidencias esperadas. Una nota nueva con solo voz se clasificó en QuasarPunk con `transcript_match`, perfil 2 y confirmación de Telegram. La Etapa 4.1 también quedó verificada en producción. [Resultados de voz](multimodal-capture.md#clasificación-por-voz)

| Área | Criterio de aceptación |
| --- | --- |
| Medios | Recibir y persistir notas de voz y archivos de audio, y agruparlos con fotos y textos consecutivos de la misma sesión. |
| Sesión automática | Aplicar 90 segundos iniciales de inactividad. Configurar la ventana y la duración máxima. Reiniciar solo el contador de inactividad con cada material nuevo y comprobar el límite máximo. |
| Sesión explícita | Implementar `/nuevo`, `/listo` y `/cancelar`. Probar que una nota de voz larga cabe en una sesión explícita aunque supere los umbrales de captura automática. Una sesión cancelada no inicia la clasificación. |
| Persistencia y aislamiento | Separar por usuario y chat. Recuperar sesiones y trabajo pendiente tras reinicios. Los reenvíos de Telegram y los reintentos de transcripción o cierre no deben procesar dos veces la sesión. |
| Transcripción y clasificación | Usar un proveedor configurable y evaluar primero alternativas locales y gratuitas. Probar transcripciones pendientes y reintentos. Clasificar el conjunto solo después de finalizar la captura y obtener las transcripciones necesarias. |
| Compatibilidad | Conservar el acceso a los registros históricos y cubrir la recepción de texto y fotografía, los callbacks y el contrato actual con pruebas de regresión. |

Para repetir la prueba de voz, usá el bot de desarrollo desde un chat privado autorizado. Enviá `/nuevo`, grabá una nota que mencione QuasarPunk y enviá `/listo`. Confirmá `CLASSIFIED`, `transcript_match`, audio persistido y transcripción presente en un único registro. [Procedimiento de despliegue y reversión](multimodal-capture.md#despliegue-futuro-y-reversión)

## Próxima misión

Validar en `@Test_Social_Hub_bot` la combinación recomendada `llama3.2:3b` + prompt 2.1 + perfiles 3, con una captura ficticia y `Instrucciones: sin hashtags; sin emojis`. Confirmar texto redactado, hechos conservados, lote `DRAFT` reutilizado, cero publicaciones y registro fuente intacto. Si el resultado y la revisión humana son satisfactorios, decidir la integración de `dev/editorial-quality` en `main`; no desplegar en producción ni iniciar la Etapa 6 sin autorización. El relay de desarrollo ya quedó reconstruido con el modelo recomendado y polling activo para esa prueba breve; después de usar Telegram, recrearlo con `TELEGRAM_POLLING=0`. [Resultados y límites](editorial-drafts.md#etapa-51-calidad-editorial)
