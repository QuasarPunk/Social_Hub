# Traspaso de Social Hub 0.1

## Estado técnico

La Etapa 4 está desplegada con n8n 2.48.6. El relay es el único receptor de Telegram y procesa mensajes y callbacks. SH-01 recibe mensajes por una ruta interna con Header Auth y ejecuta SH-02. El relay conserva el registro, descarga la foto, clasifica con el catálogo de `projects/*/profile.json` y resuelve las pulsaciones sobre el mismo registro. El contrato persistido es `CLASSIFIED` 1.0. [Arquitectura y contrato](editorial-classification.md)

- El entorno principal usa `docker-compose.yml` junto con `compose.telegram-main.yml`. Conserva su SQLite en el volumen de n8n y el material en `storage/records` y `storage/incoming`.
- El entorno de desarrollo usa `compose.telegram-dev.yml`, el proyecto Compose `social-hub-telegram-dev`, n8n en `127.0.0.1:5680` y sus propios volúmenes. Usá datos ficticios y mantené desactivado el polling real salvo durante una prueba autorizada.
- Las copias saneadas para desplegar están en `workflows/SH-01-telegram-integrado.json` y `workflows/SH-02-clasificacion-integrada.json`. El procedimiento de corte y reversión está documentado. [Despliegue principal](editorial-classification.md#procedimiento-de-despliegue-principal)

## Último hito y pendientes

- Pasaron la matriz de ocho criterios, la suite de regresión y la integración aislada. El bot de desarrollo comprobó texto, foto, clasificación por identificador y alias, teclados ambiguos e idempotencia.
- En el bot principal se verificaron la clasificación automática, la selección manual y la persistencia de una fotografía que n8n pudo leer. Los 25 registros y 5 archivos históricos conservaron sus bytes. La Etapa 4 quedó cerrada.
- La rama `dev/multimodal-capture` implementa la Etapa 4.1. La revisión de audios reales confirmó que los nombres deformados por la transcripción no coincidían con el catálogo anterior. La corrección usa alias de voz exactos y contexto de catálogo en el transcriptor. La Etapa 5 sigue pendiente. [Diagnóstico y solución](multimodal-capture.md#clasificación-por-voz)
- El entorno principal ya ejecuta la Etapa 4.1 con el overlay multimodal y un único receptor. El respaldo local previo al corte se verificó con SHA-256 y una restauración de SQLite. Los 36 archivos históricos conservaron sus bytes. Pasaron 44 pruebas y el smoke test con n8n 2.48.6. [Procedimiento de despliegue y reversión](multimodal-capture.md#despliegue-futuro-y-reversión)
- Falta comprobar una captura real en el bot principal. Debe reunir una foto sin descripción y una nota de voz que mencione QuasarPunk en una sesión iniciada con `/nuevo` y cerrada con `/listo`. Confirmar ambos originales, la transcripción, `CLASSIFIED` 1.0 con `transcript_match` y la respuesta de Telegram. Después, registrar el cierre en `main` e iniciar `dev/editorial-ai`.

## Problemas conocidos

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

Pasaron 44 pruebas de Node.js y la integración de n8n. La relectura de tres notas reales dejó intactos los archivos y recuperó las dos coincidencias esperadas. Una nota nueva con solo voz se clasificó en QuasarPunk con `transcript_match`, perfil 2 y confirmación de Telegram. La Etapa 4.1 quedó validada en desarrollo y aguarda autorización para desplegarse en el entorno principal. [Resultados de voz](multimodal-capture.md#clasificación-por-voz)

| Área | Criterio de aceptación |
| --- | --- |
| Medios | Recibir y persistir notas de voz y archivos de audio, y agruparlos con fotos y textos consecutivos de la misma sesión. |
| Sesión automática | Aplicar 90 segundos iniciales de inactividad. Configurar la ventana y la duración máxima. Reiniciar solo el contador de inactividad con cada material nuevo y comprobar el límite máximo. |
| Sesión explícita | Implementar `/nuevo`, `/listo` y `/cancelar`. Probar que una nota de voz larga cabe en una sesión explícita aunque supere los umbrales de captura automática. Una sesión cancelada no inicia la clasificación. |
| Persistencia y aislamiento | Separar por usuario y chat. Recuperar sesiones y trabajo pendiente tras reinicios. Los reenvíos de Telegram y los reintentos de transcripción o cierre no deben procesar dos veces la sesión. |
| Transcripción y clasificación | Usar un proveedor configurable y evaluar primero alternativas locales y gratuitas. Probar transcripciones pendientes y reintentos. Clasificar el conjunto solo después de finalizar la captura y obtener las transcripciones necesarias. |
| Compatibilidad | Conservar el acceso a los registros históricos y cubrir la recepción de texto y fotografía, los callbacks y el contrato actual con pruebas de regresión. |

Para repetir la prueba de voz, usá el bot de desarrollo desde un chat privado autorizado. Enviá `/nuevo`, grabá una nota que mencione QuasarPunk y enviá `/listo`. Confirmá `CLASSIFIED`, `transcript_match`, audio persistido y transcripción presente en un único registro. La próxima misión es el despliegue principal al recibir autorización. [Procedimiento de despliegue y reversión](multimodal-capture.md#despliegue-futuro-y-reversión)
