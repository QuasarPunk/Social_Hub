# Social Hub

- Trabajá en una rama de Git. Conservá las exportaciones originales y prepará copias saneadas para las pruebas y la revisión.
- Versioná JSON legible en UTF-8, con nombres de nodos descriptivos. Al renombrar un nodo, revisá conexiones y expresiones que lo referencien.
- Registrá la versión de n8n y la versión de los nodos al cambiar un workflow. Usá perfiles JSON versionados como fuente del catálogo editorial.
- Usá datos ficticios, credenciales de prueba y almacenamiento separado. Excluí del repositorio secretos, referencias privadas de credenciales, IDs de instancias, chats reales, webhooks y datos de ejecución.
- Ejecutá `node --test tests/*.test.cjs` para los cambios en el teclado. Para la verificación con n8n, seguí [el procedimiento de desarrollo](docs/development-workflow.md).
- Solicitá autorización antes de operar sobre workflows publicados, webhooks, datos reales o infraestructura externa, enviar mensajes reales o hacer push.
