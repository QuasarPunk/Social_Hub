# Traspaso de Social Hub 0.1

## Estado técnico

La Etapa 4 está desplegada con n8n 2.48.6. El relay es el único receptor de Telegram y procesa mensajes y callbacks. SH-01 recibe mensajes por una ruta interna con Header Auth y ejecuta SH-02. El relay conserva el registro, descarga la foto, clasifica con el catálogo de `projects/*/profile.json` y resuelve las pulsaciones sobre el mismo registro. El contrato persistido es `CLASSIFIED` 1.0. [Arquitectura y contrato](editorial-classification.md)

- El entorno principal usa `docker-compose.yml` junto con `compose.telegram-main.yml`. Conserva su SQLite en el volumen de n8n y el material en `storage/records` y `storage/incoming`.
- El entorno de desarrollo usa `compose.telegram-dev.yml`, el proyecto Compose `social-hub-telegram-dev`, n8n en `127.0.0.1:5680` y sus propios volúmenes. Usá datos ficticios y mantené desactivado el polling real salvo durante una prueba autorizada.
- Las copias saneadas para desplegar están en `workflows/SH-01-telegram-integrado.json` y `workflows/SH-02-clasificacion-integrada.json`. El procedimiento de corte y reversión está documentado. [Despliegue principal](editorial-classification.md#procedimiento-de-despliegue-principal)

## Último hito y pendientes

- Pasaron la matriz de ocho criterios, la suite de regresión y la integración aislada. El bot de desarrollo comprobó texto, foto, clasificación por identificador y alias, teclados ambiguos e idempotencia.
- En el bot principal se verificaron la clasificación automática y la selección manual, con respuesta de Telegram a los callbacks. Los 25 registros y 5 archivos históricos del corte conservaron sus bytes. Queda pendiente comprobar una foto nueva con ese bot.
- La siguiente misión es implementar la Etapa 4.1 en desarrollo. La Etapa 5 sigue pendiente.

## Problemas conocidos

- Si Telegram acepta un teclado justo antes de un timeout, un reintento puede mostrar otro teclado para el mismo registro. La primera selección válida se conserva.
- Los registros clasificados antes del contrato 1.0 conservan su formato y no tienen una revisión editorial histórica asignada por el sistema.
- Las exportaciones antiguas del historial incluyen metadatos privados. El árbol de trabajo usa copias saneadas. Consultá el informe técnico y mantené fuera de Git los secretos, datos reales y exportaciones crudas. [Revisión del historial](editorial-classification.md#revisión-del-historial)

## Verificación

Desde la raíz, en PowerShell con Node.js 22 y Docker disponible:

```powershell
node --test tests/*.test.cjs
docker compose --env-file .env.example -p social-hub-telegram-dev -f compose.telegram-dev.yml config --quiet
node scripts/prepare-telegram-dev.cjs --integrated
```

El último comando prepara los borradores y la credencial interna de una instancia de desarrollo ya configurada. Usalo con los secretos de desarrollo y antes de publicar los workflows. Para probar sin credenciales ni red externa, ejecutá el smoke test de n8n con Telegram simulado. [Comando reproducible de integración](editorial-classification.md#verificación-aislada)

## Próxima misión de la Etapa 4.1

Implementar captura multimodal y sesiones sin cambiar el consumidor único de Telegram ni empezar la generación editorial. Revisar primero `services/telegram-relay/callbacks.cjs` para el despacho, `intake.cjs` para la persistencia y `editorial.cjs` para la clasificación. Reusar el catálogo versionado y evaluar los cambios necesarios en SH-01 y SH-02 con la integración aislada.

| Área | Criterio de aceptación |
| --- | --- |
| Medios | Recibir y persistir notas de voz y archivos de audio, y agruparlos con fotos y textos consecutivos de la misma sesión. |
| Sesión automática | Aplicar 90 segundos iniciales de inactividad. Configurar la ventana y la duración máxima. Reiniciar solo el contador de inactividad con cada material nuevo y comprobar el límite máximo. |
| Sesión explícita | Implementar `/nuevo`, `/listo` y `/cancelar`. Probar que una nota de voz larga cabe en una sesión explícita aunque supere los umbrales de captura automática. Una sesión cancelada no inicia la clasificación. |
| Persistencia y aislamiento | Separar por usuario y chat. Recuperar sesiones y trabajo pendiente tras reinicios. Los reenvíos de Telegram y los reintentos de transcripción o cierre no deben procesar dos veces la sesión. |
| Transcripción y clasificación | Usar un proveedor configurable y evaluar primero alternativas locales y gratuitas. Probar transcripciones pendientes y reintentos. Clasificar el conjunto solo después de finalizar la captura y obtener las transcripciones necesarias. |
| Compatibilidad | Conservar el acceso a los registros históricos y cubrir la recepción de texto y fotografía, los callbacks y el contrato actual con pruebas de regresión. |

Usá un reloj controlado para las pruebas de inactividad y proveedores simulados para probar reintentos sin servicios pagos. Documentá la calidad, los requisitos locales y las alternativas antes de elegir el proveedor. Como parte del cierre, actualizá este traspaso, README.md, la documentación técnica y las pruebas para que cualquier agente pueda continuar.
