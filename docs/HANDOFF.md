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
- La validación real posterior **falló**: `Hace una publicación para QuasarPunk hablando de los botones pulsadores` produjo un borrador que reproducía la instrucción, con apertura genérica, pregunta final y hashtag. El diagnóstico está registrado abajo. No hay autorización para integrar `dev/editorial-quality` en `main`. [Diagnóstico](#diagnóstico-de-calidad-editorial--validación-51-fallida)
- La corrección v3 quedó implementada y validada con entradas ficticias: modos `generativo`, `documental` y `mixto`, prompt `3.2`, contrato sin `opening`/`cta`, saneamiento de frases genéricas y bloqueo de `/borrador` con captura activa. Pasaron 69 pruebas y los tres casos con `llama3.2:3b`. La aprobación real en `@Test_Social_Hub_bot`, la integración en `main` y el despliegue siguen pendientes. [Corrección](#corrección-de-calidad-v3-y-validación-aislada)

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

## Diagnóstico de calidad editorial — validación 5.1 fallida

**Solicitud.** `Hace una publicación para QuasarPunk hablando de los botones pulsadores`. Se usaron entradas ficticias y el mismo texto para las tres comparaciones. No se descargaron modelos, no se modificó producción, no se integró la rama en `main` y no se inició la Etapa 6.

### Modelo y prompt activos

El lote real de Telegram `mm-2fa82daceb4807bd27ff.json` declara `provider=ollama`, `model=llama3.2:3b`, `prompt_version=2.1` y `attempted=1`. El relay de desarrollo también quedó verificado con `EDITORIAL_MODEL=llama3.2:3b`. Por lo tanto, la recomendación de la Etapa 5.1 sí estaba activa; el fallo no se debe a que se haya usado el modelo o el prompt anteriores.

### Resultados comparativos

**1. Respuesta directa de Ollama**, sin prompt editorial, con la sola instrucción del usuario:

```text
**¡Descubre el Futuro del Diseño con Botones Pulsadores!**

Hola, comunidad de QuasarPunk!

En este post, vamos a hablar sobre uno de los elementos más influyentes en la creación de interfaces de usuario: los botones pulsadores. ¿Sabías que los botones pulsadores pueden transformar completamente la forma en que interactuamos con una aplicación o dispositivo?

**¿Qué son los botones pulsadores?**

Un botón pulsador es un elemento de interacción que se activa cuando se presiona o se toca durante un período determinado de tiempo. Los botones pulsadores están diseñados para proporcionar una sensación de retroalimentación táctil, lo que hace que el usuario se sienta más conectado con la aplicación o dispositivo.

**Beneficios de los botones pulsadores**

Los botones pulsadores ofrecen varios beneficios para el diseño y la experiencia del usuario:

*   **Mejora la respuesta**: Los botones pulsadores pueden responder rápidamente a las acciones del usuario, lo que reduce la latencia y mejora la experiencia general.
*   **Incrementa la usabilidad**: La retroalimentación táctil de los botones pulsadores puede ayudar a los usuarios a identificar cómo interactuar con una aplicación o dispositivo.
*   **Aumenta la fidelidad del usuario**: Los botones pulsadores pueden proporcionar una sensación de satisfacción y logro, lo que puede aumentar la fidelidad del usuario.

**Cómo crear botones pulsadores efectivos**

Para crear botones pulsadores efectivos, sigue estos consejos:

*   **Elige el color adecuado**: Elige un color que se destaque en el diseño y que sea fácil de ver para los usuarios con discapacidades visuales.
*   **Ajusta la retroalimentación**: Ajusta la retroalimentación táctil según la aplicación o dispositivo para asegurarte de que sea suficiente para identificar la interacción del usuario.
*   **Prueba y ajusta**: Prueba los botones pulsadores con diferentes usuarios y ajusta según sea necesario.

**Conclusión**

En resumen, los botones pulsadores pueden ser una herramienta poderosa en el diseño y la experiencia del usuario. Al seguir estos consejos y considerar las necesidades de tus usuarios, puedes crear botones pulsadores efectivos que mejoren la respuesta, la usabilidad y la fidelidad del usuario.

¿Cuál es tu opinión sobre los botones pulsadores? ¿Tienes alguna pregunta o comentario? ¡Comparte en el commentario abajo!

¡Gracias por leer este post!
```

El texto directo es genérico y demasiado extenso, pero desarrolla el tema. Esto descarta que el modelo sea incapaz de hablar de botones pulsadores.

**2. Respuesta original del modelo con el prompt editorial completo de Social Hub**, capturada en el límite del proveedor antes de validación y posprocesamiento:

```json
{
  "destinations": {
    "instagram": {
      "opening": 1,
      "fragments": [0],
      "copy": "Los botones pulsadores: la clave para una experiencia interactiva"
    },
    "facebook": {
      "opening": 2,
      "fragments": [0],
      "copy": "¿Qué son los botones pulsadores y cómo pueden mejorar tu proyecto?"
    }
  },
  "visual": "documento"
}
```

**3. Resultado final de SH-03** para la misma solicitud, después de validación, saneamiento y respaldo:

```text
Instagram
✦ Dinámico, visual y atractivo.

Hace una publicación para QuasarPunk hablando de los botones pulsadores

¿Qué te llama la atención?

#QuasarPunk

Facebook
Desde QuasarPunk

Hace una publicación para QuasarPunk hablando de los botones pulsadores

¿Qué te gustaría sumar a la conversación?

#QuasarPunk
```

El lote real recibido en Telegram tuvo el mismo patrón, con la forma original del texto (`HAce una publicacion...`), `warnings=["foto_sin_interpretacion_visual","cobertura_incompleta","copia_modelo_no_usada","copia_null"]` y `errors=[]`.

### Causa identificada

La solicitud fue tratada como **material documental**, no como una instrucción de tema. `contentFragments` solo reconoce como controles las líneas con `Instrucciones:` o `Formato:`; el resto se convierte en hechos. La frase del usuario no tiene ese prefijo, por lo que `services/telegram-relay/editorial-drafts.cjs:83-104` la persistió como fragmento verificable.

La copia del modelo existió, pero fue descartada por la comprobación de cobertura. `coveredByCopy` exige que al menos el 60 % de las palabras del fragmento aparezcan en la copia. La frase de la solicitud aporta `publicacion`, `quasarpunk`, `hablando`, `botones` y `pulsadores`; las copias originales solo contenían `botones` y `pulsadores`, así que no alcanzaron el umbral. En `services/telegram-relay/editorial-drafts.cjs:248-255` se activó `cobertura_incompleta`, `copia_modelo_no_usada` y `copia_null`; este último nombre es engañoso porque la copia del modelo no era nula, sino que se descartó por cobertura.

Descartada la copia, el motor usó el respaldo determinista de `services/telegram-relay/editorial-drafts.cjs:256-270`: apertura del perfil o `Desde <proyecto>`, fragmentos literales, llamada a la acción y hashtag por preferencias. Eso explica exactamente el encabezado genérico, la pregunta final y `#QuasarPunk`. No hubo fallback por error del proveedor ni ausencia de respuesta: hubo un fallback por la regla de cobertura.

No se activó `instruccion_para_revision` porque la frase no empezaba con el prefijo reconocido. La restricción de no inventar acontecimientos se aplicó también al tema solicitado, impidiendo el modo generativo. El prompt `services/telegram-relay/editorial-prompts/v2.json:3` pide trabajar solo con fragmentos y no distingue tema, hecho, explicación general ni modo mixto.

### `/borrador` con captura abierta

`services/telegram-relay/editorial-preview.cjs:24` llama a `editorial.latest(chat_id, user)` sin consultar la sesión activa. `services/telegram-relay/editorial-drafts.cjs:307-312` elige el registro `CLASSIFIED` más reciente por `updated_at` y no filtra por captura abierta. Por eso, si hay una captura abierta sin clasificar, `/borrador` puede devolver el lote de la captura anterior. No es un fallo del modelo ni del prompt.

### Rotación de la clave interna de desarrollo

Se generó una nueva clave criptográfica para `secrets/telegram-dev/relay-key`, se recreó el relay de desarrollo y se reimportó la credencial Header Auth de n8n con el mismo identificador lógico. No se mostró ninguna clave. La verificación desde el contenedor de n8n devolvió `401` para una clave no vigente y `404` para la clave vigente, lo que confirma que el relay rechaza credenciales distintas de la actual y acepta la sincronizada. La clave expuesta literalmente en una sesión anterior no quedó disponible en el repositorio ni en el historiallocal; no se conservó una copia antes de sobrescribir la credencial, por lo que no se pudo repetir la prueba con ese valor exacto sin volver a exponerlo. Si el operador lo conserva, puede entregarlo por canal privado para comprobarlo sin imprimirlo. No se tocó la credencial de producción.

### Corrección recomendada, pendiente de aprobación

1. Clasificar la intención antes de construir fragmentos: `documental` para acontecimientos proporcionados, `generativo` para temas solicitados y `mixto` para ambos. Una frase como `Hace una publicación sobre X` debe producir un `topic`, no un fragmento de hecho.
2. Enviar `mode` y `topic` al prompt. En modo generativo se permite usar conocimiento general pertinente; la prohibición sigue aplicando a nombres, fechas, lugares, precios, resultados y atribuciones concretas no proporcionadas.
3. Aplicar `coveredByCopy` solo a fragmentos documentales. Para el tema generativo, reemplazar la coincidencia literal por una comprobación de que la copia desarrolla el tema sin introducir hechos particulares.
4. No agregar apertura, pregunta final ni hashtag cuando la solicitud pide una publicación lisa, o al menos tratar `sin pregunta final` y `sin hashtags` como controles derivados del lenguaje natural, no solo del prefijo `Instrucciones:`.
5. Renombrar `copia_null` a `copia_descartada_por_cobertura` o registrar el motivo real para que el traspaso no sugiera un fallo del modelo.
6. Hacer que `/borrador` vincule la solicitud a la captura activa, o rechazarla con un mensaje explícito mientras haya una captura abierta sin clasificar, en lugar de usar `latest`.

## Corrección de calidad v3 y validación aislada

**Cambios.** `editorial-drafts.cjs` clasifica la intención antes de construir fragmentos y distingue hechos documentales, temas solicitados, instrucciones y restricciones en `generativo`, `documental` y `mixto`. El prompt `editorial-prompts/v3.json` quedó en versión `3.2` y viaja en `generation.prompt_version`. El contrato del proveedor pide `destinations` y `visual`; cada destino exige `copy` y `fragments`, sin `opening` ni `cta`. La fidelidad dejó de usar el umbral rígido del 60 %: ahora solo emite advertencias `fidelity_review` y `fidelity_numbers_review`. `cleanCopy` conserva la copia del modelo, sanea hashtags y emojis, quita repeticiones de la instrucción, frases como «En este post» o «Descubre», CTA no pedidas y artefactos del modelo, y registra avisos como `frases_genericas_omitidas`, `llamada_accion_omitida` o `artefactos_modelo_omitidos`. El proveedor de plantillas dejó de intervenir en silencio: su resultado se marca como `template_fallback`.

**Captura activa.** `capture.cjs` expone `pending(chat,user)` y `editorial-preview.cjs` rechaza `/borrador` con un mensaje explícito mientras exista una sesión `OPEN`, `SEALED` o `FAILED`; ya no reutiliza el lote anterior.

**Comandos y resultados.** `node --test tests/*.test.cjs`: 69 pruebas, 69 correctas. Reconstrucción del relay con `$dev up -d --no-deps --build telegram-relay` y harness aislado con `llama3.2:3b`, Ollama local y datos ficticios. Los tres casos terminaron en `DRAFT` con `provenance=model` y un intento: `val-gen-botones` (`generativo`, 35.956 ms, `warnings=[]`), `val-doc-compostaje` (`documental`, 43.148 ms, `warnings=[]`) y `val-mix-sensor` (`mixto`, 36.593 ms, `warnings=[frases_genericas_omitidas, emojis_modelo_omitidos]`). Las salidas conservaron los hechos y las restricciones; no se imprimieron prompts, credenciales ni respuestas crudas. La variabilidad del modelo puede requerir el segundo intento o saneamiento, y los textos siguen necesitando revisión humana.

## Próxima misión

Repetir la validación real en `@Test_Social_Hub_bot` con los tres casos ficticios y `llama3.2:3b` + prompt `3.2`, confirmar el bloqueo de `/borrador` durante una captura abierta y revisar los textos antes de proponer integración. No integrar `dev/editorial-quality` en `main`, no desplegar en producción y no iniciar la Etapa 6 sin autorización nueva. [Diagnóstico](#diagnóstico-de-calidad-editorial--validación-51-fallida)
