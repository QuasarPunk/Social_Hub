# Etapa 5 · SH-03 y borradores editoriales

## Elección del proveedor

| Alternativa | Acceso y condiciones | Decisión |
| --- | --- | --- |
| Ollama local con Qwen2.5 1.5B | Modelo abierto Apache 2.0 cuantizado Q4_K_M y multilingüe. El archivo pesa unos 986 MB. Se probó Ollama 0.13.5 en CPU. | Predeterminado para desarrollo. Generó un lote válido en español para Instagram, Facebook y LinkedIn en 40,8 segundos con texto y voz transcrita. Opera en la red privada, con nube deshabilitada y sin clave ni cuota de API. [Modelo](https://ollama.com/library/qwen2.5:1.5b) · [Esquemas JSON](https://docs.ollama.com/capabilities/structured-outputs) |
| Ollama local con Qwen3-VL 2B | Modelo abierto cuantizado con visión, de unos 1,9 GB. La variante inicial agotó los tokens en razonamiento y devolvió un mensaje sin JSON. | El adaptador acepta visión opcional. El modo de validación usa descripciones y transcripciones hasta verificar otro modelo visual con el esquema y la latencia del equipo. [Modelo](https://ollama.com/library/qwen3-vl:2b-instruct) · [Visión](https://docs.ollama.com/capabilities/vision) |
| Gemini API gratuita | Requiere clave y un proyecto compatible. El acceso a modelos es limitado y las cuotas varían por modelo y proyecto en solicitudes y tokens. La política del nivel gratuito advierte que el contenido puede usarse para mejorar productos. | Alternativa evaluada por documentación. Para considerar un adaptador, verificar la cuota vigente de la cuenta y usar fixtures antes de autorizar el envío de datos. [Precios](https://ai.google.dev/gemini-api/docs/pricing) · [Cuotas](https://ai.google.dev/gemini-api/docs/rate-limits) |
| Groq API gratuita | Requiere una clave propia. Las cuotas dependen del modelo y los esquemas estrictos solo están disponibles en modelos compatibles. | Alternativa evaluada por documentación. Conviene medir español editorial, visión y validación de esquema con una cuenta autorizada antes de decidir. [Cuotas](https://console.groq.com/docs/rate-limits) · [Salidas estructuradas](https://console.groq.com/docs/structured-outputs) |
| Plantillas locales | Funcionan sin modelo ni red. Reutilizan el mismo contrato y las mismas restricciones editoriales. | Respaldo configurable con `EDITORIAL_PROVIDER=template`. La plantilla conserva el orden de la fuente y ofrece menos selección editorial. |

El equipo disponible tiene un Ryzen 5 4600G y 7,46 GiB disponibles para Docker. El contenedor de desarrollo usa un modelo a la vez y un contexto de 4096 tokens. Las cuotas de nube y la calidad en español de servicios externos no se comprobaron con cuentas. Los modelos accesibles desde OpenCode se evalúan por separado de las APIs de Social Hub.

La segunda prueba real agregó una foto ficticia y su descripción. El modelo entregó los tres borradores en 28,6 segundos, con las referencias multimedia y las restricciones de hashtags. El contenedor con el modelo cargado usó cerca de 1,55 GiB de RAM. Los tiempos incluyen condiciones de carga distintas y sirven como referencia para esta máquina.

## Arquitectura

SH-03 es un webhook autenticado de n8n 2.48.6 con nodos Webhook 2.1 y HTTP Request 4.5. Recibe `{"content_id":"..."}` y solicita `POST /drafts` al relay con la credencial interna. El motor lee el registro persistido `CLASSIFIED` 1.0, usa la copia del perfil y admite el contrato de captura multimodal 1.0. El borrador de Telegram llama al mismo motor con `/borrador` y responde con una vista previa del último registro clasificado del autor en ese chat. Se puede indicar `instagram`, `facebook` o `linkedin`.

El motor manda al proveedor un prompt de sistema versionado y, en otro mensaje, el material como datos. El modelo elige y ordena citas de la fuente y selecciona una apertura española entre opciones editoriales. Un validador independiente comprueba plataformas, índices, categorías y límites. El motor compone el texto a partir de esas citas, la apertura y una pregunta editorial opcional. Así, una respuesta del proveedor no puede introducir nombres, fechas, cifras, eventos ni nuevas afirmaciones en el texto. Los perfiles conservan su independencia del proveedor y determinan tono, formatos y plataformas.

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
docker exec social-hub-editorial-model-warmup ollama pull qwen2.5:1.5b
docker stop social-hub-editorial-model-warmup
$env:TELEGRAM_MULTIMODAL='1'
node scripts/prepare-telegram-dev.cjs --editorial
```

Publicá SH-03 en n8n de desarrollo. El comando prepara su borrador y conserva SH-01 y SH-02. Para la prueba real usá exclusivamente el bot de desarrollo. Habilitá su polling con el overlay editorial y mantené un solo relay. Luego volvé a deshabilitarlo.

Para revertir SH-03, despublicá el workflow editorial y recreá el relay de desarrollo con su Compose base, conservando los volúmenes y usando `TELEGRAM_MULTIMODAL=1` si querés seguir probando captura. El servicio Ollama puede detenerse por separado. Un futuro despliegue principal requiere autorización y un overlay propio con volumen de borradores y red privada. La publicación y aprobación quedan para la Etapa 6.

## Verificación y prueba humana

Ejecutá `node --test tests/*.test.cjs` y el smoke test aislado de n8n. `tests/editorial-model-smoke.cjs` verifica el proveedor real con un directorio efímero, una foto ficticia opcional y un perfil de prueba que habilita las tres plataformas. Usá la imagen del relay con el test montado en `/test/editorial-model-smoke.cjs`, el catálogo en `/projects` y la red `social-hub-telegram-dev_telegram_internal`. [Integración aislada](editorial-classification.md#verificación-aislada)

Enviá `/nuevo` al bot de desarrollo y agregá una foto de prueba. Escribí `QuasarPunk: En un taller de prueba usamos una placa Arduino.` y, en otra línea, `Instrucciones: sin hashtags; sin emojis`. Enviá `/listo`, esperá la clasificación y pedí `/borrador instagram`. Después pedí `/borrador facebook` para comprobar que la captura reutiliza el mismo lote.
