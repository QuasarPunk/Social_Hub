# Traspaso de Social Hub 0.1

## Estado técnico

La Etapa 4.1 está desplegada con n8n 2.48.6. El relay es el único receptor de Telegram y procesa mensajes y callbacks. SH-01 recibe mensajes por una ruta interna con Header Auth y ejecuta SH-02. El relay conserva los originales, transcribe y clasifica con el catálogo de `projects/*/profile.json`. El contrato persistido es `CLASSIFIED` 1.0. [Arquitectura y contrato](editorial-classification.md)

- El entorno principal usa `docker-compose.yml` junto con `compose.telegram-main.yml`. Conserva su SQLite en el volumen de n8n y el material en `storage/records` y `storage/incoming`.
- El entorno de desarrollo usa `compose.telegram-dev.yml`, el proyecto Compose `social-hub-telegram-dev`, n8n en `127.0.0.1:5680` y sus propios volúmenes. Usá datos ficticios y mantené desactivado el polling real salvo durante una prueba autorizada.
- Las copias saneadas para desplegar están en `workflows/SH-01-telegram-integrado.json` y `workflows/SH-02-clasificacion-integrada.json`. El procedimiento de corte y reversión está documentado. [Despliegue principal](editorial-classification.md#procedimiento-de-despliegue-principal)

## Último hito y pendientes

- Pasaron la matriz de ocho criterios, la suite de regresión y la integración aislada. El bot de desarrollo comprobó texto, foto, clasificación por identificador y alias, teclados ambiguos e idempotencia.
- En el bot principal se verificaron la clasificación automática, la selección manual y la persistencia de una fotografía que n8n pudo leer. Los 25 registros y 5 archivos históricos conservaron sus bytes. La Etapa 4 quedó cerrada.
- La rama `dev/multimodal-capture` implementa la Etapa 4.1. La revisión de audios reales confirmó que los nombres deformados por la transcripción no coincidían con el catálogo anterior. La corrección usa alias de voz exactos y contexto de catálogo en el transcriptor. La Etapa 5 sigue pendiente. [Diagnóstico y solución](multimodal-capture.md#clasificación-por-voz)
- El entorno principal ya ejecuta la Etapa 4.1 con el overlay multimodal y un único receptor. El respaldo local previo al corte se verificó con SHA-256 y una restauración de SQLite. Los 36 archivos históricos conservaron sus bytes. Pasaron 44 pruebas y el smoke test con n8n 2.48.6. [Procedimiento de despliegue y reversión](multimodal-capture.md#despliegue-futuro-y-reversión)
- La Etapa 4.1 quedó cerrada. El bot principal confirmó una captura real con foto y voz, transcripción local y clasificación en QuasarPunk con `transcript_match`. n8n leyó ambos originales y el registro con los mismos SHA-256. [Validación en producción](multimodal-capture.md#validación-en-producción)
- `dev/editorial-ai` incorpora SH-03. Las vistas previas reales de Instagram y Facebook fallaron, incluidos los reintentos. La integración en `main` queda pendiente de resolver el defecto y validar Telegram en desarrollo. [Incidencia](#incidencia-sh-03-en-telegram)
- Pasaron 59 pruebas de Node.js y el smoke test de SH-01, SH-02 y SH-03 con n8n 2.48.6. Qwen2.5 1.5B generó en CPU borradores distintos para Instagram, Facebook y LinkedIn con un perfil ficticio. Para revisar la prueba humana, comprobá que los dos comandos `/borrador` reutilicen el mismo JSON del volumen de borradores y que sigan presentes los originales. [Contrato y verificación](editorial-drafts.md#verificación-y-prueba-humana)

## Problemas conocidos

### Incidencia SH-03 en Telegram

El bot de desarrollo respondió «No se pudo preparar el borrador. Podés reintentar con /borrador.» a `/borrador instagram` y `/borrador facebook`. El relay, n8n, Ollama y el transcriptor quedaron en ejecución. No se reiniciaron los servicios ni se ejecutaron nuevas inferencias durante el cierre.

**Evidencia sanitizada.** El registro de prueba con una foto y dos materiales de texto está en `CLASSIFIED` 1.0, con perfil 2 e Instagram y Facebook habilitados. No existe un lote en `/data/drafts` para ese registro. Ollama registró varias llamadas `POST /api/chat` con HTTP 200 y tiempos de 10 a 20 segundos. El log del relay no registró un código editorial para esos intentos. La respuesta del bot colapsa varios errores en el mismo mensaje. Un rechazo del JSON del proveedor o del plan por el validador es una hipótesis compatible con estos síntomas. HTTP 200 solo confirma la respuesta del proveedor.

**Primer paso para OpenCode.** En `services/telegram-relay/editorial-preview.cjs`, capturá de forma temporal el código de error saneado del bloque que llama a `editorial.request`. Reproducí una sola vez con una captura ficticia. Registrá etapa, código y conteos, sin imprimir el contenido ni la respuesta cruda del modelo. Si resulta `invalid_provider_response`, distinguí el parseo de Ollama en `editorial-provider.cjs` de la validación de destinos, índices y límites en `editorial-drafts.cjs`. Revisá también qué registro eligió `latest` sin registrar su identificador. El workflow `workflows/SH-03-borradores-editoriales.json` llama al mismo motor mediante la ruta interna autenticada. El comando de Telegram lo invoca directamente.

```powershell
git switch dev/editorial-ai
$dev = @('--env-file','.env.example','-p','social-hub-telegram-dev','-f','compose.telegram-dev.yml','-f','compose.editorial-dev.yml','--profile','editorial-model')
docker compose @dev ps
docker compose @dev logs --tail 30 telegram-relay ollama
node --test tests/editorial-drafts.test.cjs
```

Para reproducir en Telegram de desarrollo, cerrá una captura ficticia clasificada en un proyecto con Instagram y Facebook y ejecutá `/borrador instagram`. Cuando funcione, comprobá que `/borrador facebook` reutilice el lote y que la captura original se conserve. Con la corrección lista, ejecutá la regresión completa antes de integrar. [Contrato y pruebas](editorial-drafts.md#verificación-y-prueba-humana)

- Si Telegram acepta un teclado justo antes de un timeout, un reintento puede mostrar otro teclado para el mismo registro. La primera selección válida se conserva.
- Los registros clasificados antes del contrato 1.0 conservan su formato y no tienen una revisión editorial histórica asignada por el sistema.
- Las exportaciones antiguas del historial incluyen metadatos privados. El árbol de trabajo usa copias saneadas. Consultá el informe técnico y mantené fuera de Git los secretos, datos reales y exportaciones crudas. [Revisión del historial](editorial-classification.md#revisión-del-historial)
- El endpoint de descarga de Telegram limita el archivo a 20 MiB. Una transcripción fallida conserva el audio y puede reintentarse con `/listo`. El worker procesa una captura sellada a la vez. Los diarios acumulan metadatos de deduplicación. [Diseño y operación](multimodal-capture.md)

## Verificación

Desde la raíz, en PowerShell con Node.js 22 y Docker disponible:

```powershell
node --test tests/*.test.cjs
docker compose --env-file .env.example -p social-hub-telegram-dev -f compose.telegram-dev.yml config --quiet
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
