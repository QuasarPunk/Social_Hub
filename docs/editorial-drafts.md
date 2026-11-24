# Etapa 5 · SH-03 y borradores editoriales

## Elección del proveedor

| Alternativa | Acceso y condiciones | Decisión |
| --- | --- | --- |
| Ollama local con Qwen2.5 1.5B | Modelo abierto Apache 2.0 cuantizado Q4_K_M y multilingüe. El archivo pesa unos 986 MB. Se probó Ollama 0.13.5 en CPU. | Modelo de la validación original de SH-03 y referencia de velocidad. Generó un lote válido en español para Instagram, Facebook y LinkedIn en 40,8 segundos con texto y voz transcrita. Opera en la red privada, con nube deshabilitada y sin clave ni cuota de API. [Modelo](https://ollama.com/library/qwen2.5:1.5b) · [Esquemas JSON](https://docs.ollama.com/capabilities/structured-outputs) |
| Ollama local con Llama 3.2 3B | Modelo abierto bajo licencia Llama 3.2, cuantizado y ejecutado en CPU. | Recomendado para desarrollo desde la Etapa 5.1 con el prompt 2.1. Tuvo la mejor cobertura de hechos y cumplimiento de restricciones en las tres capturas ficticias. No está aprobado para producción. [Modelo](https://ollama.com/library/llama3.2:3b) |
| Ollama local con Qwen2.5 3B | Modelo abierto Apache 2.0, cuantizado y ejecutado en CPU. | Evaluado en la Etapa 5.1. Diferenció mejor las plataformas, pero omitió hechos verificables e introdujo hashtags y emojis que el motor saneó. [Modelo](https://ollama.com/library/qwen2.5:3b) |
| Ollama local con Qwen3-VL 2B | Modelo abierto cuantizado con visión, de unos 1,9 GB. La variante inicial agotó los tokens en razonamiento y devolvió un mensaje sin JSON. | El adaptador acepta visión opcional. El modo de validación usa descripciones y transcripciones hasta verificar otro modelo visual con el esquema y la latencia del equipo. [Modelo](https://ollama.com/library/qwen3-vl:2b-instruct) · [Visión](https://docs.ollama.com/capabilities/vision) |
| Gemini API gratuita | Requiere clave y un proyecto compatible. El acceso a modelos es limitado y las cuotas varían por modelo y proyecto en solicitudes y tokens. La política del nivel gratuito advierte que el contenido puede usarse para mejorar productos. | Alternativa evaluada por documentación. Para considerar un adaptador, verificar la cuota vigente de la cuenta y usar fixtures antes de autorizar el envío de datos. [Precios](https://ai.google.dev/gemini-api/docs/pricing) · [Cuotas](https://ai.google.dev/gemini-api/docs/rate-limits) |
| Groq API gratuita | Requiere una clave propia. Las cuotas dependen del modelo y los esquemas estrictos solo están disponibles en modelos compatibles. | Alternativa evaluada por documentación. Conviene medir español editorial, visión y validación de esquema con una cuenta autorizada antes de decidir. [Cuotas](https://console.groq.com/docs/rate-limits) · [Salidas estructuradas](https://console.groq.com/docs/structured-outputs) |
| Plantillas locales | Funcionan sin modelo ni red. Reutilizan el mismo contrato y las mismas restricciones editoriales. | Respaldo configurable con `EDITORIAL_PROVIDER=template`. La plantilla conserva el orden de la fuente y ofrece menos selección editorial. |

El equipo disponible tiene un Ryzen 5 4600G y 7,46 GiB disponibles para Docker. El contenedor de desarrollo usa un modelo a la vez y un contexto de 4096 tokens. Las cuotas de nube y la calidad en español de servicios externos no se comprobaron con cuentas. Los modelos accesibles desde OpenCode se evalúan por separado de las APIs de Social Hub.

La segunda prueba real agregó una foto ficticia y su descripción. El modelo entregó los tres borradores en 28,6 segundos, con las referencias multimedia y las restricciones de hashtags. El contenedor con el modelo cargado usó cerca de 1,55 GiB de RAM. Los tiempos incluyen condiciones de carga distintas y sirven como referencia para esta máquina.

## Arquitectura

SH-03 es un webhook autenticado de n8n 2.48.6 con nodos Webhook 2.1 y HTTP Request 4.5. Recibe `{"content_id":"..."}` y solicita `POST /drafts` al relay con la credencial interna. El motor lee el registro persistido `CLASSIFIED` 1.0, usa la copia del perfil y admite el contrato de captura multimodal 1.0. El borrador de Telegram llama al mismo motor con `/borrador` y responde con una vista previa del último registro clasificado del autor en ese chat. Se puede indicar `instagram`, `facebook` o `linkedin`.

El motor manda al proveedor un prompt de sistema versionado y, en otro mensaje, el material como datos. Desde el prompt 2.0 el modelo propone también una `copy` por plataforma. Un validador independiente comprueba plataformas, índices, categorías, límites y cobertura de los hechos; sanea hashtags y emojis, y usa el ensamble trazable de citas y aperturas cuando la copia del modelo está ausente, es inválida u omite información verificable. Así, una respuesta del proveedor no puede introducir nombres, fechas, cifras, eventos ni nuevas afirmaciones sin control. Los perfiles conservan su independencia del proveedor y determinan tono, formatos y plataformas.

Se admiten controles explícitos en una línea `Instrucciones: breve; en viñetas; sin hashtags; sin emojis; sin llamada a la acción`. Las indicaciones libres que excedan esos controles se marcan para revisión. Se filtran patrones de órdenes internas y se conservan los hechos de la fuente como citas. Los filtros por patrones son auxiliares. El modelo carece de herramientas y su salida se limita a índices de citas y opciones permitidas. El operador debe revisar que las citas incluidas sean aptas para publicar.

Con `EDITORIAL_VISION=1`, un modelo compatible recibe hasta dos JPEG de hasta 3 MiB cada uno. La categoría visual se registra como sugerencia y se mantiene separada del texto. Las fotos conservan sus rutas y originales. Ante un error reintentable, el segundo intento vuelve al texto, las descripciones y las transcripciones. Con el modelo de texto validado, las fotos se adjuntan y su contexto procede de la descripción y la voz transcrita. Si la captura carece de hechos escritos o transcritos, el motor pide material adicional.

## Contrato de borradores 1.0

Un lote se escribe en `/files/drafts/<content_id>.json` y contiene:

| Campo | Significado |
| --- | --- |
| `draft_contract_version`, `content_id` | Versión `1.0` y referencia al registro original. |
| `project_id`, `profile_version`, `status` | Identidad editorial, revisión aplicada y estado `DRAFT`. |
| `generation` | Proveedor, modelo, versión del prompt, número de intentos, fecha UTC y categoría visual cuando corresponda. |
| `drafts[]` | ID estable, plataforma, formato, estado, texto, hashtags y referencias multimedia. |
| `warnings`, `errors` | Advertencias del lote y errores asociados. Si falla la generación, el endpoint responde con un código de error y **el lote no se persiste**. |

El lote reutiliza un borrador del mismo contenido ante reentregas o reinicios. El worker admite una generación simultánea y reintenta una vez los errores recuperables. Un límite de cuota se devuelve al solicitante sin reintento inmediato. La escritura del lote es atómica y el registro de origen permanece intacto. Instagram, Facebook y LinkedIn se habilitan solo si aparecen tanto en la revisión editorial persistida como en `target_platforms`. Los perfiles actuales habilitan Instagram y Facebook. LinkedIn está cubierto con un perfil de prueba habilitado.

## Instalación y reversión

La Etapa 5 solo está habilitada mediante `compose.editorial-dev.yml`. Con desarrollo configurado y el bot de pruebas inactivo, prepará el modelo una vez. Consultá `ollama list` antes de continuar y esperá a que responda el servidor de preparación si acaba de iniciar.

```powershell
docker run --rm -d --name social-hub-editorial-model-warmup -e OLLAMA_NO_CLOUD=1 --mount "type=volume,source=social-hub-telegram-dev_ollama_models,target=/root/.ollama" ollama/ollama:0.13.5
docker exec social-hub-editorial-model-warmup ollama pull llama3.2:3b
docker exec social-hub-editorial-model-warmup ollama pull qwen2.5:1.5b
docker stop social-hub-editorial-model-warmup
$env:TELEGRAM_MULTIMODAL='1'
node scripts/prepare-telegram-dev.cjs --editorial
```

Publicá SH-03 en n8n de desarrollo. El comando prepara su borrador y conserva SH-01 y SH-02. Para la prueba real usá exclusivamente el bot de desarrollo. Habilitá su polling con el overlay editorial y mantené un solo relay. Luego volvé a deshabilitarlo.

Para revertir SH-03, despublicá el workflow editorial y recreá el relay de desarrollo con su Compose base, conservando los volúmenes y usando `TELEGRAM_MULTIMODAL=1` si querés seguir probando captura. El servicio Ollama puede detenerse por separado. Un futuro despliegue principal requiere autorización y un overlay propio con volumen de borradores y red privada. La publicación y aprobación quedan para la Etapa 6.

## Incidencia de la vista previa y corrección

La reproducción única con un registro ficticio `CLASSIFIED` y Qwen2.5 1.5B registró `editorial.request stage=repro code=invalid_provider_response reason=fragments_duplicate`, dos intentos y cero lotes escritos. HTTP 200 del proveedor solo confirmó la respuesta; el rechazo ocurrió en el validador local. El registro seleccionado por `latest` era el más reciente del chat y no se modificó.

El registro tenía **un solo fragmento** utilizable, pero el esquema ofrecía `maxItems: 5` para Facebook. Ollama 0.13.5 respetó `maxItems` pero ignoró `uniqueItems` y devolvió cinco IDs repetidos. Como el validador exige selecciones distintas, lanzó `invalid_provider_response`, el motor reintentó una vez y no persistió nada. No había un fallo de parseo, de credenciales ni de red.

La corrección tiene tres partes:

1. El esquema declara `uniqueItems: true` y limita `maxItems` a `Math.min(config.max_fragments, ids.length)`.
2. Si un proveedor repite IDs pese al esquema, el validador conserva el primer ID de cada uno, agrega `fragmentos_repetidos_omitidos` a `warnings` y sigue rechazando el resto de las violaciones del contrato.
3. `editorial-preview.cjs` y `/drafts` registran `editorial.request stage=<preview|workflow> code=<código> reason=<razón>` con listas de valores permitidos. No se imprimen prompts, respuestas crudas, IDs de contenido ni materiales.

**Verificación tras la corrección.** Pasaron 63 pruebas de Node.js, el smoke test aislado de n8n 2.48.6 y una generación real con el mismo registro ficticio: `attempted=1`, `status=DRAFT`, dos plataformas, cero errores, cero advertencias, lote persistido y registro fuente idéntico. El endpoint autenticado de SH-03 en n8n de desarrollo devolvió el mismo lote reutilizado (`provider=ollama`, `attempted=1`). El smoke test con proveedor real y textos ficticios respetó `sin hashtags; sin emojis` en Instagram, Facebook y LinkedIn. La validación final con `@Test_Social_Hub_bot` fue confirmada por el operador; no se publicó nada en producción.

**Limitación conocida.** La generación estructurada de Ollama 0.13.5 no garantiza `uniqueItems`. El límite de `maxItems` y la normalización defensiva evitan borradores duplicados sin introducir hechos nuevos. Si aparecen otras violaciones, se registran con su código y razón saneados y el lote no se persiste. La comparación posterior de modelos y prompts se documenta en [Etapa 5.1](#etapa-51-calidad-editorial).

## Validación real confirmada

El operador confirmó la recepción correcta de los borradores de Instagram y Facebook en `@Test_Social_Hub_bot`, sin hashtags ni emojis. La inspección de los volúmenes de desarrollo identificó el lote generado después de la última captura: dos borradores en un único archivo `DRAFT`, con `draft_id` derivados del mismo `content_id`, plataformas `instagram` y `facebook`, un solo `generated_at` y un solo `generation.attempted=1`. El registro fuente sigue en `CLASSIFIED` 1.0 del perfil QuasarPunk 2, con `updated_at` anterior a la generación; el motor solo leyó el registro y escribió el archivo de borradores.

El lote declara `generation.provider=ollama`, `generation.model=qwen2.5:1.5b` y `prompt_version=1.0`. No intervino el proveedor determinista de plantillas. Ambos textos conservan el hecho del taller y la placa Arduino; ninguno contiene `#` ni emojis. Quedó registrada la advertencia saneada `foto_sin_interpretacion_visual` porque el despliegue de desarrollo tiene `EDITORIAL_VISION=0`: la foto se preservó como medio pero no se envió al modelo. Ese es un dato de calidad para la Etapa 5.1, no un error de SH-03.

No aparecieron líneas `editorial.request` con error en el relay de desarrollo desde el reinicio. Tampoco aparecieron eventos de publicación en los registros de n8n de desarrollo ni en los contenedores de producción. El volumen conserva un lote anterior de prueba con hashtag y emoji; pertenece a una captura distinta y no forma parte de esta validación final.

## Verificación y prueba humana

Ejecutá `node --test tests/*.test.cjs` y el smoke test aislado de n8n. `tests/editorial-model-smoke.cjs` verifica el proveedor real con un directorio efímero, una foto ficticia opcional y un perfil de prueba que habilita las tres plataformas. Usá la imagen del relay con el test montado en `/test/editorial-model-smoke.cjs`, el catálogo en `/projects` y la red `social-hub-telegram-dev_telegram_internal`. [Integración aislada](editorial-classification.md#verificación-aislada)

Secuencia única de validación real en `@Test_Social_Hub_bot`:

1. Enviá `/nuevo`, una foto ficticia y este texto en dos líneas: `QuasarPunk: En un taller de prueba usamos una placa Arduino.` y `Instrucciones: sin hashtags; sin emojis`.
2. Enviá `/listo` y esperá la confirmación `CLASSIFIED`.
3. Enviá `/borrador instagram`. Debe llegar un borrador con la placa Arduino, sin `#` ni emojis.
4. Enviá `/borrador facebook`. Debe llegar otro texto del mismo lote y con las mismas restricciones.

Criterios de aceptación: los dos borradores tienen plataformas distintas, el lote se reutiliza con un solo `generation.attempted`, el registro original y la foto siguen presentes y sin cambios, no hay mensajes de publicación automática y el log del relay solo registra `editorial.request` si hay un error. Ante un fallo, informá el `code` y la `reason` saneados; no reenvíes la captura hasta analizarlos.

## Etapa 5.1: Calidad editorial

**Objetivo.** Mejorar la calidad del borrador sin codificar identidades en workflows, sin tocar producción y sin iniciar la Etapa 6. Se evaluaron como máximo tres modelos locales gratuitos en el mismo equipo y con un conjunto fijo de tres capturas ficticias: taller de QuasarPunk con Arduino, huerta de Ecoaldea Lamat y muestra cultural de Bitácora.

### Recursos medidos

```powershell
docker info --format 'cpus={{.NCPU}} memory_bytes={{.MemTotal}}'
docker exec social-hub-telegram-dev-ollama-1 nproc
docker exec social-hub-telegram-dev-ollama-1 free -m
docker exec social-hub-telegram-dev-ollama-1 bash -lc "df -h /; lspci 2>/dev/null | Select-String -Pattern 'vga|3d|display'"
```

| Recurso | Resultado |
| --- | --- |
| CPU del equipo | AMD Ryzen 5 4600G con Radeon Graphics, 6 núcleos y 12 hilos lógicos. |
| Memoria asignada a Docker | 8.006.090.752 bytes (7,46 GiB). |
| CPU visible en Ollama | 12 núcleos. |
| RAM visible en Ollama | 7.635 MB totales, 5.230 MB disponibles antes de cargar un modelo. |
| Disco | `overlay` de 1007 GB con 938 GB libres (2 % usado). |
| GPU en Ollama | No detectada. Todo el trabajo se ejecutó en CPU. |
| Host | 15,4 GB de RAM y gráficos integrados AMD Radeon. |

### Cambios aplicados

- Prompt versionado `services/telegram-relay/editorial-prompts/v2.json`, versión **2.1**. Pide texto redactado, no meras citas; separa hechos de interpretación; prohíbe hashtags, emojis, inventarios y preguntas finales cuando la instrucción lo indica; y exige aperturas, order y longitudes distintas por plataforma.
- Perfiles `projects/*/profile.json` en `profile_version: 3`. Agregan `editorial.narrative_notes` con dos pistas narrativas derivadas de la identidad existente. No se cambiaron nombres, alias, tono, audiencia, temas, restricciones ni plataformas.
- `editorial-drafts.cjs` pasa esas notas al `input`, carga el prompt 2.1, exige `copy` en el esquema del proveedor y conserva compatibilidad con el proveedor determinista mediante `copy` opcional en `validatePlan`.
- `cleanCopy` elimina hashtags, emojis, prefijos de rol, cercos de código y repetición del prompt. `contentWords` y `coveredByCopy` comparan la copia con los hechos extraídos. Ante omisión, se usa el ensamble trazable y se registra `cobertura_incompleta`.
- `platformMenus` usa `editorial.style` y los estilos por plataforma del perfil. `editorial-provider.cjs` baja `temperature` a `0.2` y eleva `num_predict` a `1024`.
- `compose.editorial-dev.yml` y los smoke tests toman `llama3.2:3b` como modelo predeterminado de desarrollo.

### Método reproducible

```powershell
$dev = @('--env-file','.env.example','-p','social-hub-telegram-dev','-f','compose.telegram-dev.yml','-f','compose.editorial-dev.yml','--profile','multimodal','--profile','editorial-model')
$env:TELEGRAM_MULTIMODAL='1'
$env:TELEGRAM_POLLING='0'
docker compose @dev up -d --no-deps --build telegram-relay

docker exec social-hub-telegram-dev-ollama-1 ollama pull llama3.2:3b
docker exec social-hub-telegram-dev-ollama-1 ollama pull qwen2.5:3b
docker exec social-hub-telegram-dev-ollama-1 ollama pull qwen2.5:1.5b
```

El comparador usa datos ficticios de `tests/fixtures/editorial-quality.json`, montados en `/test` y `/projects` dentro de una imagen efímera del relay:

```powershell
$img = 'social-hub-telegram-dev-telegram-relay'
foreach ($m in @('qwen2.5:1.5b','qwen2.5:3b','llama3.2:3b')) {
  docker exec social-hub-telegram-dev-ollama-1 ollama stop $m
  docker run --rm --network social-hub-telegram-dev_telegram_internal `
    -v "$PWD\tests:/test:ro" -v "$PWD\projects:/projects:ro" `
    -e EDITORIAL_MODEL=$m --entrypoint node $img /test/editorial-quality-compare.cjs
  docker stats --no-stream --format '{{.MemUsage}}' social-hub-telegram-dev-ollama-1
}
```

El comparador mide hechos presentes, respeto de restricciones, ausencia de aperturas genéricas, diferenciación entre Instagram y Facebook y solapamiento de texto. No escribe lotes, no llama a Telegram y no usa credenciales reales.

### Resultados

Tiempos y memoria corresponden a la corrida final con prompt 2.1 y perfiles versión 3; la memoria se leyó con el último modelo cargado.

| Modelo | Tiempo total | Memoria pico observada | Hechos correctos | Restricciones | Plataformas distintas | Advertencias del motor |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `qwen2.5:1.5b` | 90,1 s | 3,513 GiB | 1/3 | 3/3 | 1/3 | Ninguna |
| `qwen2.5:3b` | 153,4 s | 4,356 GiB | 0/3 | 3/3 | 3/3 | Hashtags en 3 casos y emoji en 1, todos saneados |
| `llama3.2:3b` | 160,4 s | 4,944 GiB | 3/3 | 3/3 | 2/3 | Ninguna |

Detalle por caso con `llama3.2:3b`:

| Caso | Tiempo | Hechos | Restricciones | Diferenciación | Solapamiento |
| --- | ---: | --- | --- | --- | --- |
| QuasarPunk / taller Arduino | 61,7 s | Correctos | Correctas | Sí | 0,82 |
| Lamat / huerta comunitaria | 50,7 s | Correctos | Correctas | Sí | 1,00 |
| Bitácora / muestra cultural | 47,9 s | Correctos | Correctas | No | 1,00 |

Ejemplo real de la corrida, usando solo datos ficticios:

> **Instagram:** En la Biblioteca Norte realizamos un taller de electrónica con una placa Arduino y sensores. Participaron estudiantes y docentes.
>
> **Facebook:** En la Biblioteca Norte se llevó a cabo un taller de electrónica con una placa Arduino y sensores. Los participantes fueron estudiantes y docentes.

La restricción `sin llamada a la acción` se respetó en el caso de Bitácora. En el caso de Lamat, Facebook incorporó la misión del perfil antes del hecho; no es texto inventado, pero muestra que el modelo aún puede agregar contexto general.

### Recomendación

Usar **`llama3.2:3b` con el prompt 2.1 y perfiles versión 3** como referencia de desarrollo. Es la única combinación que conservó los tres hechos verificables y respetó todas las restricciones en los tres casos. Cuesta cerca del doble de tiempo que `qwen2.5:1.5b` y unos 1,4 GiB más de RAM; el costo se compensa con la fidelidad. `qwen2.5:3b` diferenció más pero perdió hechos y exigió saneamiento adicional.

La recomendación no implica aprobación de calidad editorial ni despliegue. Falta una validación real en `@Test_Social_Hub_bot` con la nueva combinación y la revisión humana de los textos antes de cualquier cambio en producción.

### Límites conocidos

- El texto aún es sobrio y a veces queda demasiado cerca de la fuente; la diferenciación entre plataformas mejora, pero no es estable en todos los casos.
- `llama3.2:3b` no estuvo disponible en el primer lote SH-03; el lote validado en Telegram sigue siendo `qwen2.5:1.5b` con prompt 1.0.
- `qwen3-vl:2b` quedó fuera de esta comparación: el cupo de tres modelos se usó para los modelos de texto. No se evaluó visión real.
- Las métricas dependen de una CPU sin GPU y de una sola corrida por modelo; no son comparables con otro equipo ni garantizan resultados idénticos.
- El prompt y las notas narrativas no sustituyen la revisión humana. Ningún borrador debe publicarse automáticamente en esta versión.
