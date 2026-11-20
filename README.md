# Social Hub

**Sistema inteligente y autohospedado de gestión de contenidos para redes sociales**

> **Estado:** En desarrollo · **Versión objetivo:** 0.1 (prototipo) · **Etapa 1: Infraestructura — completada · Etapa 2: Telegram — completada (respuesta autónoma confirmada)**

## ¿Qué es Social Hub?

Social Hub es un proyecto para centralizar y automatizar progresivamente la producción, revisión y distribución de contenido en redes sociales. Su objetivo es transformar materiales en bruto —fotografías, videos, enlaces, audios e instrucciones— en publicaciones adaptadas a cada proyecto y plataforma, reduciendo el trabajo repetitivo sin perder el control editorial humano.

El sistema prioriza herramientas autohospedables, software libre cuando sea posible, costos operativos bajos y una arquitectura modular que pueda ampliarse por etapas.

## Proyectos gestionados

| Proyecto | Identidad editorial |
| --- | --- |
| **QuasarPunk** | Robótica, electrónica, programación, automatización, educación tecnológica y cultura maker. |
| **Ecoaldea Lamat** | Permacultura, agroecología, bioconstrucción, educación ambiental, vida comunitaria y comunicación territorial. Incluye los contenidos de **Radio Lamat**, que comparte las redes de Ecoaldea Lamat. |

**Radio Lamat no se gestiona como un tercer perfil independiente.**

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
| **Perfiles editoriales** | Definir estilo y criterios de cada proyecto | Pendiente |
| **IA multimodal** | Interpretar material y generar borradores | Pendiente; proveedor/modelo por definir |
| **Almacenamiento de materiales** | Guardar archivos recibidos y borradores | Estructura local creada; integración pendiente |
| **OpenCode** | Asistencia durante el desarrollo | Herramienta de desarrollo, no servicio de producción |

La arquitectura procurará mantener separada la entrada de mensajes del procesamiento editorial para poder incorporar WhatsApp u otros canales más adelante.

## Estructura del repositorio

```text
Social_Hub/
├── docker-compose.yml    # Servicio n8n y volumen persistente
├── .env.example          # Plantilla de configuración (sin secretos)
├── .env                  # Variables y claves locales (ignorado por Git)
├── .gitignore
├── README.md
├── projects/             # Perfiles editoriales de QuasarPunk y Lamat
├── workflows/            # Exportaciones y documentación de workflows
├── storage/              # Archivos y borradores locales (ignorado por Git)
└── docs/                 # Documentación técnica y bitácora
```

> Las carpetas de trabajo pueden estar vacías mientras no se implementen sus respectivas funciones. Los workflows guardados en n8n viven inicialmente en su base de datos; **no se exportan automáticamente** a `workflows/`.

## Ejecución local

**Requisitos:** Docker Desktop con Docker Compose funcionando. El entorno inicial se desarrolló sobre Windows 11 x64 con WSL 2.

1. Crear un archivo `.env` a partir de `.env.example` y completar los valores requeridos.
2. Generar una clave de cifrado única para `N8N_ENCRYPTION_KEY` y guardarla de forma segura.
3. Desde la raíz del repositorio, ejecutar:

```powershell
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
```

4. Abrir **http://localhost:5678** y acceder con la cuenta de propietario configurada en n8n.

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

## Hoja de ruta

| Etapa | Entregable | Estado |
| --- | --- | --- |
| **1. Infraestructura** | Docker, Compose, n8n Community, configuración y persistencia | **Completada** |
| **2. Telegram** | Bot, webhook HTTPS, filtro por chat y respuesta | **Completada** (exportación del workflow pendiente como tarea documental) |
| **3. Ingesta** | Recepción y almacenamiento de fotografías e instrucciones | Pendiente |
| **4. Contexto editorial** | Clasificación y perfiles de QuasarPunk y Ecoaldea Lamat | Pendiente |
| **5. Generación con IA** | Borradores contextualizados a partir de texto e imagen | Pendiente |
| **6. Aprobación** | Aprobar, corregir o descartar desde Telegram | Pendiente |
| **7. Validación** | Pruebas integrales, manejo de errores y documentación | Pendiente |

### Etapa 3 — Recepción de materiales (próxima sesión)

**Objetivo:** transformar los mensajes entrantes de Telegram en registros de contenido identificables y persistentes, sin generar publicaciones todavía.

1. **Definir el formato de entrada:** aceptar mensajes de texto, fotografías con descripción (*caption*) y fotografías sin texto; decidir cómo solicitar una instrucción faltante.
2. **Normalizar los datos:** obtener `update_id`, `message_id`, identificador de chat, fecha, texto/caption, tipo de contenido e identificadores de archivo, evitando duplicados.
3. **Descargar fotografías:** usar la API oficial de Telegram desde n8n y comprobar el tamaño y formato del archivo recibido.
4. **Preparar almacenamiento persistente:** montar `storage/incoming/` del repositorio en el contenedor (o adoptar otro volumen persistente) con permisos adecuados; comprobar que los archivos sobreviven a la recreación del contenedor.
5. **Guardar metadatos:** registrar un identificador único, la ruta del archivo y el estado inicial `RECEIVED`, sin exponer información privada en Git.
6. **Confirmar recepción:** responder por Telegram con un acuse de recibo y el identificador del material.
7. **Probar y documentar:** ensayar texto solo, fotografía sola, fotografía con descripción, mensajes repetidos y fallos de descarga; exportar el workflow saneado y actualizar este README.

**Criterio de cierre:** un mensaje o fotografía enviado al bot queda registrado de manera persistente, con metadatos básicos y confirmación de recepción, sin intervención manual en n8n. La clasificación entre QuasarPunk y Ecoaldea Lamat corresponde a la Etapa 4.

**Nota técnica:** el volumen `n8n_data` conserva la información interna de n8n, pero **no** guarda automáticamente los archivos en `storage/incoming/`. Habrá que montar y probar ese almacenamiento de forma explícita.

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

- Creación del bot **Social Hub** (`@YourSocialHub_bot`) mediante BotFather.
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

## Principios de desarrollo

1. **Incremental:** completar y probar cada etapa antes de incorporar la siguiente.
2. **Supervisión humana:** ninguna publicación automática en la versión 0.1.
3. **Modularidad:** desacoplar canales, perfiles editoriales y generación de contenido.
4. **Privacidad:** proteger credenciales y evitar exponer servicios innecesariamente.
5. **Trazabilidad:** registrar estados, errores y decisiones importantes.
6. **Simplicidad:** no añadir servicios que el prototipo todavía no necesita.

---

**Estado actual:** Etapas 1 y 2 completadas. **Próximo hito:** Etapa 3 — recepción y almacenamiento de fotografías e instrucciones. La exportación saneada de `SH-01` y el respaldo de la configuración siguen pendientes como tareas de mantenimiento.
