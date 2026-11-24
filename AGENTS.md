# Social Hub

- Trabajá en una rama de Git. Conservá las exportaciones originales y prepará copias saneadas para las pruebas y la revisión.
- Versioná JSON legible en UTF-8, con nombres de nodos descriptivos. Al renombrar un nodo, revisá conexiones y expresiones que lo referencien.
- Registrá la versión de n8n y la versión de los nodos al cambiar un workflow. Usá perfiles JSON versionados como fuente del catálogo editorial.
- Usá datos ficticios, credenciales de prueba y almacenamiento separado. Excluí del repositorio secretos, referencias privadas de credenciales, IDs de instancias, chats reales, webhooks y datos de ejecución.
- Ejecutá `node --test tests/*.test.cjs` para los cambios en el teclado. Para la verificación con n8n, seguí [el procedimiento de desarrollo](docs/development-workflow.md).
- Para el servicio interno de Telegram, usá secretos de Compose y una credencial Header Auth de n8n para la clave interna. Verificá el envío con [Telegram simulado y n8n aislado](docs/telegram-relay.md#verificación-aislada).
- Solicitá autorización antes de operar sobre workflows publicados, webhooks, datos reales o infraestructura externa, enviar mensajes reales o hacer push.
- Aplicá Free First. Priorizá software libre, modelos abiertos, opciones locales viables y niveles gratuitos. No contrates servicios ni actives facturación. Documentá los límites de calidad y las alternativas cuando una opción gratuita resulte insuficiente. Seguí avanzando donde sea viable y mantené los proveedores pagos futuros como opciones.
- Empezá cada misión leyendo [el traspaso](docs/HANDOFF.md). Al cerrarla, actualizá el traspaso, README.md, la documentación técnica pertinente y las pruebas necesarias. Registrá decisiones, comandos, resultados, problemas conocidos y la próxima misión en el repositorio para que Codex, OpenCode u otro agente pueda continuar sin acceder a la conversación anterior.
- Para la captura multimodal, usá volúmenes separados, Telegram simulado, un reloj controlado y un proveedor de transcripción de prueba. Verificá el smoke test de n8n y la preservación de los registros históricos. [Captura multimodal](docs/multimodal-capture.md)
- Definí las variantes conocidas de nombres hablados en `spoken_aliases` del perfil y actualizá `profile_version`. Conservá la transcripción original y cubrí casos neutros y ambiguos al cambiar la clasificación por voz. [Clasificación por voz](docs/multimodal-capture.md#clasificación-por-voz)
- Aplicá Automation First. Probá con fixtures y servicios simulados antes de usar Telegram real. Mantené `main` estable e integrá cambios funcionales después de verificar la rama de desarrollo.
- Para SH-03 probá el proveedor con datos ficticios y preservá el contrato de `DRAFT`. Mantené apartados los prompts y los datos del contenido, validá la respuesta antes de persistirla y protegé los originales. [Motor editorial](docs/editorial-drafts.md)
