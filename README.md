# Social Hub

**Sistema inteligente y autohospedado de gestión de contenidos para redes sociales**

> **Estado:** En desarrollo · **Versión objetivo:** 0.1 (prototipo) · Etapas 4 y 4.1 completadas en el entorno principal

## ¿Qué es Social Hub?

Social Hub es un proyecto para centralizar y automatizar progresivamente la producción, revisión y distribución de contenido en redes sociales. Su objetivo es transformar materiales en bruto —fotografías, videos, enlaces, audios e instrucciones— en publicaciones adaptadas a cada proyecto y plataforma, reduciendo el trabajo repetitivo sin perder el control editorial humano.

El sistema prioriza herramientas autohospedables, software libre cuando sea posible, costos operativos bajos y una arquitectura modular que pueda ampliarse por etapas.

## Principios de desarrollo

- **Free First.** Social Hub debe poder operar sin depender de servicios pagos. Priorizamos software libre, herramientas gratuitas, modelos abiertos y niveles gratuitos. Probamos opciones locales cuando sean técnicamente viables. No contratamos servicios ni activamos facturación. Si una función no alcanza una calidad razonable con opciones gratuitas, documentamos el límite y las alternativas y seguimos con el trabajo que pueda avanzar. Los proveedores pagos pueden incorporarse como opciones futuras.
- **Independencia del agente.** Codex, OpenCode u otros agentes pueden retomar el trabajo a partir del repositorio. Cada misión termina con las pruebas y la documentación técnica al día, y con un [traspaso](docs/HANDOFF.md) que registre el estado, el último hito, los pendientes, los problemas conocidos, los comandos de verificación y la próxima misión. Las decisiones y el contexto operativo se conservan en el repositorio.

## Perfiles editoriales de ejemplo

| Proyecto | Identidad editorial |
| --- | --- |
| **QuasarPunk** | Robótica, electrónica, programación, automatización, educación tecnológica y cultura maker. |
| **Ecoaldea Lamat** | Permacultura, agroecología, bioconstrucción, educación ambiental, vida comunitaria y comunicación territorial. Incluye los contenidos de **Radio Lamat**, que comparte las redes de Ecoaldea Lamat. |
| **Bitácora** | Perfil editorial de bitácora incluido en el catálogo de prueba. |

Los perfiles activos se descubren desde `projects/*/profile.json`. Radio Lamat se incluye en el perfil de Ecoaldea Lamat. La plantilla permanece inactiva.

## Objetivo del prototipo 0.1

Construir un flujo en el que una persona pueda enviar una fotografía y/o una instrucción mediante **Telegram**, seleccionar o indicar el proyecto, recibir un borrador generado con ayuda de IA y **aprobarlo, pedir correcciones o descartarlo**.

La versión 0.1 **no publicará automáticamente** en redes sociales.

### Flujo previsto

```text
Telegram (texto / fotografía)
           ↓
Recepción y almacenamiento
           ↓
Identificación del proyecto
           ↓
Perfil editorial + IA
           ↓
Borrador de publicación
           ↓
Revisión humana en Telegram
           ↓
Aprobar / Corregir / Descartar
           ↓
Registro del resultado
```

Si el proyecto no está claro, el sistema deberá pedir una aclaración en lugar de adivinar.

## Arquitectura y herramientas

| Componente | Función | Estado |
| --- | --- | --- |
| **Docker Desktop / Docker Compose** | Ejecutar y administrar servicios en contenedores | Operativo |
| **n8n Community (autohospedado)** | Orquestar automatizaciones y workflows | Operativo |
| **SQLite integrado en n8n** | Persistir datos internos de n8n | Operativo; persistencia comprobada |
| **Volumen Docker `n8n_data`** | Conservar configuración, base de datos y credenciales cifradas entre reinicios | Operativo |
| **Telegram Bot API** | Canal de entrada y respuesta inicial | Operativo: recepción, autorización por chat y respuesta autónoma comprobadas |
| **Cloudflare Quick Tunnel** | Exponer temporalmente el webhook HTTPS de n8n | Operativo durante las pruebas; URL temporal |
| **Perfiles editoriales** | Definir estilo y criterios de cada proyecto | Catálogo dinámico y resolución por identificador, alias o selección interactiva |
| **IA multimodal** | Interpretar material y generar borradores | Pendiente; proveedor/modelo por definir |
| **Almacenamiento de materiales** | Guardar archivos recibidos y borradores | Operativo: fotografías y registros JSON persistentes |
| **Codex, OpenCode u otros agentes** | Asistencia intercambiable durante el desarrollo | Contexto y verificación versionados en el repositorio |

La arquitectura procurará mantener separada la entrada de mensajes del procesamiento editorial para poder incorporar WhatsApp u otros canales más adelante.

## Estructura del repositorio

```text
Social_Hub/
├── docker-compose.yml    # Servicio n8n y volumen persistente
├── .env.example          # Plantilla de configuración (sin secretos)
├── .env                  # Variables y claves locales (ignorado por Git)
├── .gitignore
├── README.md
├── projects/             # Configuraciones editoriales de proyectos
├── workflows/            # Exportaciones y documentación de workflows
├── storage/              # incoming/, records/, drafts/ (ignorado por Git)
└── docs/                 # Documentación técnica y bitácora
```

> Las carpetas de trabajo pueden estar vacías mientras no se implementen sus respectivas funciones. Los workflows guardados en n8n viven inicialmente en su base de datos; **no se exportan automáticamente** a `workflows/`.

## Workflows actuales

- [SH-01 integrado](workflows/SH-01-telegram-integrado.json) recibe mensajes del único receptor de Telegram por HTTP interno autenticado, invoca SH-02 y devuelve su resultado. El relay autoriza el chat y responde con una confirmación o un teclado dinámico vinculado al contenido.
- [SH-02 integrado](workflows/SH-02-clasificacion-integrada.json) procesa texto y fotografías mediante el servicio interno. El relay valida perfiles, clasifica por prefijo o alias y conserva el registro y la fotografía en almacenamiento persistente. Cuando hay ambigüedad ofrece los candidatos y, sin coincidencias, el catálogo activo.
- Los callbacks llegan al mismo relay, modifican el mismo registro pendiente y conservan la primera elección. Las dos rutas comparten el [contrato de clasificación](docs/editorial-classification.md#contrato-classified-10). Las exportaciones originales y las pruebas del teclado se conservan como referencia.

Las exportaciones históricas versionadas son copias saneadas. Conservá los originales fuera de Git y seguí el [procedimiento de desarrollo](docs/development-workflow.md) antes de compartir una exportación nueva.

## Ejecución local

Para preparar el circuito integrado o reproducir su prueba aislada, seguí la [verificación de la Etapa 4](docs/editorial-classification.md#verificación-aislada). La [guía del relay](docs/telegram-relay.md) también conserva el procedimiento de la primera prueba de teclados.

**Requisitos:** Docker Desktop con Docker Compose funcionando. El entorno inicial se desarrolló sobre Windows 11 x64 con WSL 2.

Iniciar Docker Desktop y esperar a que el motor esté operativo antes de ejecutar Compose.

1. Crear un archivo `.env` a partir de `.env.example` y completar los valores requeridos.
2. Generar una clave de cifrado única para `N8N_ENCRYPTION_KEY` y guardarla de forma segura.
3. Desde la raíz del repositorio, ejecutar:

```powershell
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
```

4. Crear los directorios `storage/incoming`, `storage/records` y `storage/drafts` si no existen.
5. Abrir **http://localhost:5678** y acceder con la cuenta de propietario configurada en n8n.

Comandos habituales:

```powershell
docker compose up -d               # Iniciar
docker compose down                # Detener conservando los volúmenes
docker compose ps                  # Consultar estado
docker compose logs --tail=50 n8n  # Revisar registros
docker compose exec n8n n8n --version  # Consultar versión instalada
```

**Atención:** `docker compose down -v` elimina los volúmenes del proyecto y puede provocar pérdida de datos. No debe usarse para detener el servicio normalmente.

### Seguridad y persistencia

- El archivo `.env` contiene secretos y **no debe subirse a Git**.
- El puerto de n8n está configurado para acceso local (`127.0.0.1:5678`).
- El volumen `n8n_data` conserva los datos de n8n al recrear el contenedor.
- Conservar copias seguras de la clave de cifrado y respaldar el volumen antes de actualizaciones importantes.
- **Persistencia no equivale a copia de seguridad.** Aún queda pendiente implementar una rutina de respaldo.
- La configuración local deshabilita las cookies seguras para permitir acceso por HTTP en `localhost`. Antes de exponer n8n por Internet habrá que configurar HTTPS y revisar la seguridad.
- Se recomienda fijar una versión concreta de la imagen de n8n en lugar de mantener indefinidamente `latest`.

### Arranque del canal Telegram

La instalación principal usa el Telegram Relay como único receptor y SH-01 como ruta interna autenticada en n8n. El procedimiento técnico documenta el corte y la reversión al consumidor anterior. [Despliegue principal](docs/editorial-classification.md#procedimiento-de-despliegue-principal)

## Hoja de ruta

| Etapa | Entregable | Estado |
| --- | --- | --- |
| **1. Infraestructura** | Docker, Compose, n8n Community, configuración y persistencia | **Completada** |
| **2. Telegram** | Bot, webhook HTTPS, filtro por chat y respuesta | **Completada** (exportación del workflow pendiente como tarea documental) |
| **3. Recepción y almacenamiento** | Recepción, almacenamiento y confirmación | **Completada funcionalmente** |
| **4. Contexto editorial** | Clasificación dinámica, perfiles configurables y selección manual | Desplegada. Texto y selección validados en producción. Verificación de foto real en producción pendiente |
| **4.1. Captura multimodal y sesiones de contenido** | Captura agrupada de fotos, texto y audio con transcripción configurable | **Completada.** Validada en el entorno principal |
| **5. Generación con IA** | Borradores contextualizados por perfil y plataforma | SH-03 implementado en desarrollo. Validación real en Telegram pendiente |
| **6. Aprobación** | Aprobar, corregir o descartar desde Telegram | Pendiente |
| **7. Validación** | Pruebas integrales, manejo de errores y documentación | Pendiente |

### Etapa 4 — Clasificación e identidad editorial

Objetivo: identificar un proyecto registrado y cargar su configuración editorial sin codificar nombres de marcas dentro del workflow.

1. Definir un esquema versionado de perfil: identificador estable, nombre, alias, idioma, tono, audiencia, temas, restricciones y canales habilitados.
2. Crear perfiles de ejemplo para QuasarPunk y Ecoaldea Lamat con el mismo esquema.
3. Implementar un catálogo dinámico de perfiles y validar su configuración antes de usarla.
4. Exponer los perfiles al contenedor mediante un montaje de solo lectura, con acceso restringido a las rutas necesarias.
5. Resolver el proyecto por identificador o alias explícito; ante ambigüedad o ausencia, solicitar una selección vinculada al identificador del contenido.
6. Guardar el identificador del proyecto y la versión del perfil en el registro; preparar el contexto editorial para la IA.
7. Añadir un tercer perfil de prueba sin editar el workflow y comprobar que puede utilizarse.
8. Documentar el esquema y las pruebas.

**Decisión de diseño propuesta:** archivos JSON por proyecto en 0.1, interfaz de administración y base de datos de producto en una fase posterior. Los secretos y credenciales de plataformas no forman parte de los perfiles. El prototipo es de un único operador; una instalación compartida requerirá autenticación, autorización y aislamiento entre espacios de trabajo.

El [esquema, el contrato y la guía de verificación](docs/editorial-classification.md) registran la implementación y vinculan las pruebas con estos ocho criterios.

La validación con el bot de pruebas confirmó la clasificación por identificador y alias, los teclados para contenido sin coincidencias y con dos candidatos, y la persistencia de una fotografía. Telegram aceptó las respuestas a los callbacks y las segundas selecciones conservaron la primera elección. Los siete registros de la sesión cumplieron el contrato `CLASSIFIED` 1.0. [Validación real](docs/editorial-classification.md#validación-real-en-desarrollo)

En el bot principal se verificaron la clasificación automática por identificador y el paso de `PENDING_CLASSIFICATION` a `CLASSIFIED` mediante un teclado real, adem?s de la persistencia de una fotograf?a. El respaldo y la comparación posterior al corte confirmaron la conservación del almacenamiento histórico. [Validación principal](docs/editorial-classification.md#validación-del-entorno-principal)

### Etapa 4.1 — Captura multimodal y sesiones de contenido

El modo multimodal agrupa fotografías, textos, notas de voz y archivos de audio consecutivos en una sesión persistente por usuario y chat. La captura automática cierra tras **90 segundos de inactividad** por defecto y tiene un máximo de **10 minutos**. Ambos valores son configurables. Cada material nuevo reinicia el contador de inactividad y mantiene el vencimiento máximo.

Los comandos `/nuevo`, `/listo` y `/cancelar` abren, finalizan y cancelan una captura, respectivamente. Una sesión explícita puede esperar la llegada de notas de voz largas.

La transcripción en desarrollo usa faster-whisper local y un proveedor HTTP configurable. La clasificación editorial comienza al cerrar la captura y obtener las transcripciones necesarias. El contrato de captura agrega los medios agrupados y conserva el contexto editorial de `CLASSIFIED` 1.0. [Arquitectura, contrato y despliegue](docs/multimodal-capture.md)

Una nota de voz puede identificar un proyecto por su nombre o por un alias de voz declarado en el perfil. El relay conserva la selección manual si detecta proyectos distintos o ninguna coincidencia. [Clasificación por voz](docs/multimodal-capture.md#clasificación-por-voz)

### Etapa 5 — Motor editorial SH-03

SH-03 genera borradores en español desde registros `CLASSIFIED`, sus perfiles y sus materiales. El proveedor local selecciona fragmentos de la fuente y el motor escribe un lote `DRAFT` para los destinos habilitados. El bot de desarrollo muestra una vista previa con `/borrador`. [Contrato, proveedores y verificación](docs/editorial-drafts.md)

### Evolución futura (fuera del alcance de 0.1)

Publicación y programación mediante APIs oficiales, integración de WhatsApp, procesamiento de videos, creación de Reels/Shorts, analítica, panel de administración y soporte multiusuario.

## Registro de avances

### 19–20 de noviembre de 2026 — Etapa 1: Infraestructura completada

**Logros verificados:**

- Instalación y puesta en marcha de Docker Desktop sobre Windows 11 x64 con WSL 2.
- Verificación de Docker Engine y Docker Compose mediante `docker --version`, `docker compose version` y el contenedor de prueba `hello-world`.
- Creación de la estructura inicial del repositorio y los archivos `docker-compose.yml`, `.env`, `.env.example` y `.gitignore`.
- Validación de la configuración mediante `docker compose config --quiet`.
- Descarga y ejecución de la imagen de n8n Community.
- Acceso exitoso a la interfaz web local de n8n.
- Creación y ejecución de un workflow de prueba.
- Reinicio de los servicios y **comprobación exitosa de que el workflow y la configuración persistieron**.
- Reducción del alcance editorial inicial a **dos proyectos**: QuasarPunk y Ecoaldea Lamat, incorporando Radio Lamat dentro de este último.

**Resultado:** infraestructura local funcional y lista para iniciar la integración con Telegram.

**Próximos ajustes técnicos:** registrar y fijar la versión exacta de n8n, establecer copias de seguridad y exportar workflows relevantes al repositorio.


### 20 de noviembre de 2026 — Etapa 2: Telegram completada

**Logros comprobados:**

- Creación del bot **Social Hub** mediante BotFather.
- Instalación de Telegram en computadora y teléfono, e inicio de conversación con el bot.
- Registro del token en el gestor de credenciales de n8n; el token no forma parte del repositorio.
- Creación del workflow `SH-01 - Telegram Entrada` con **Telegram Trigger**, filtro **IF** por `chat.id` y nodo **Telegram — Send Message**.
- Instalación de `cloudflared` y apertura de un túnel HTTPS temporal de Cloudflare Quick Tunnel hacia n8n local.
- Configuración de `WEBHOOK_URL` mediante variable de entorno, evitando fijar la dirección temporal en `docker-compose.yml`.
- Recepción exitosa de un mensaje y **respuesta del bot comprobada durante una prueba interactiva**.
- Publicación/activación del workflow y **confirmación de respuesta automática sin ejecutar manualmente n8n**.

**Resultado:** Etapa 2 completada funcionalmente. El bot responde de forma autónoma cuando n8n y el túnel están activos.

**Tareas documentales y de robustez aún pendientes:** exportar un JSON saneado del workflow; registrar el commit correspondiente; probar explícitamente el rechazo de chats no autorizados.

**Limitaciones del prototipo:** Docker, n8n y el túnel deben permanecer activos. Quick Tunnel cambia de URL al reiniciarse y no se considera infraestructura de producción. La URL pública del túnel también puede exponer la interfaz administrativa de n8n; utilizar solo para pruebas y cerrarlo al finalizar.

**Seguridad del workflow:** no subir al repositorio el token del bot, el `chat.id` real, URL temporal del túnel, datos de ejecuciones ni otros identificadores privados. Para una exportación pública, sustituir el ID fijo del filtro por una configuración no sensible y revisar el JSON exportado antes del commit. La prueba de autorización negativa (chat no autorizado) sigue pendiente.

### 20 de noviembre de 2026 — Etapa 3: Recepción y almacenamiento completada

**Logros comprobados:**

- Montaje persistente `./storage:/files` y configuración `N8N_RESTRICT_FILE_ACCESS_TO: /files`; prueba de escritura desde el contenedor y lectura en Windows exitosa.
- Directorios `storage/incoming`, `storage/records` y `storage/drafts`.
- Normalización de mensajes mediante JavaScript: identificador `tg-<update_id>`, tipo, chat, mensaje, instrucción, proyecto inicialmente nulo, archivo Telegram, ruta, fecha UTC y estado.
- Clasificación mediante Switch en tres ramas (`photo`, `text`, `unsupported`). La expresión `{{ String($json.type).trim().toLowerCase() }}` resolvió un fallo de encaminamiento cuya causa exacta no se aisló.
- Descarga de fotografías con Telegram Get File (`Download` activo, binario `data`) y escritura en `/files/incoming/<content_id>.jpg`. Archivo comprobado en VS Code.
- Convergencia de texto y fotografía en `Preparar registro`, conversión a JSON y escritura en `/files/records/<content_id>.json`. Registros comprobados.
- Confirmación por Telegram posterior al almacenamiento y respuesta para formatos no soportados. Validación de las tres ramas confirmada por el operador.
- Recuperación del webhook tras una interrupción del túnel: nueva URL, actualización de `.env`, recreación de n8n y publicación del workflow.

```text
Telegram Trigger → IF autorización → Normalizar mensaje → Clasificar contenido
  ├─ photo → Descargar fotografia → Guardar fotografia ─┐
  ├─ text ──────────────────────────────────────────────┤
  │                                                     ↓
  │        Preparar registro → Generar JSON → Guardar registro → Confirmar recepcion
  └─ unsupported → Avisar formato no soportado
```

Los registros conservan `content_id`, `source`, `type`, `chat_id`, `message_id`, `instruction`, `project`, `file_id`, `media_path`, `received_at`, `status` y `stored_at`. Una fotografía tiene ruta relativa `incoming/<content_id>.jpg`; un texto tiene ruta nula. El estado almacenado es `RECEIVED`. La confirmación se emite después de guardar el registro.

**Alcance y pendientes:** fotografías individuales y textos; no se procesan audios, vídeos, documentos ni álbumes. Quedan pendientes pruebas específicas de duplicados, fallos de escritura, autorización negativa, recuperación ante errores y respaldos. No se confirma individualmente toda la batería ampliada de pruebas. Exportación saneada del workflow y commit pendientes de confirmación.

## Principios de desarrollo

1. **Incremental:** completar y probar cada etapa antes de incorporar la siguiente.
2. **Supervisión humana:** ninguna publicación automática en la versión 0.1.
3. **Modularidad:** desacoplar canales, perfiles editoriales y generación de contenido; ningún proyecto debe estar fijado en el motor.
4. **Privacidad:** proteger credenciales y evitar exponer servicios innecesariamente.
5. **Trazabilidad:** registrar estados, errores y decisiones importantes.
6. **Simplicidad:** no añadir servicios que el prototipo todavía no necesita.

---

**Estado actual:** SH-01 y SH-02 integran la recepción, el almacenamiento y la clasificación editorial en las exportaciones actuales. El próximo hito es verificar el teclado y resolver las pulsaciones antes de avanzar a la generación de borradores.
