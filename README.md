# NeoPi

NeoPi es un motor de agentes con una interfaz de terminal. Te permite conversar sobre un objetivo y, según las herramientas y permisos disponibles, investigar archivos, proponer cambios y ejecutar tareas en tu entorno. No es solamente un chat: el agente puede reunir evidencia y actuar, pero sus resultados necesitan revisión humana.

## Empezar con una tarea real

1. Elegí un proyecto y un objetivo acotado, por ejemplo: «Explicá dónde se valida el ingreso de clientes y mostrame los archivos que lo respaldan. No modifiques nada».
2. Abrí NeoPi en el directorio del proyecto y planteá el objetivo, el contexto y los límites. Indicá qué evidencia esperás y qué acciones requieren tu aprobación.
3. Revisá las referencias y resultados; preguntá por lo que falte o no coincida. Recién después pedí un cambio pequeño, acordá cómo comprobarlo y revisá el resultado. No ingreses secretos ni datos que no esté autorizado compartir.

Para usarlo precisás un ejecutable compatible, acceso configurado a un proveedor de modelos y permisos adecuados para el trabajo. Las [publicaciones de NeoPi de Cooperbit](https://github.com/CooperbitQuarxs/neopi/releases) incluyen versiones preliminares; revisá la versión, plataforma y archivos disponibles antes de elegir. La existencia de un archivo publicado no significa que su instalación se haya probado en tu equipo. El acceso y las cuentas de oficina todavía requieren configuración; no supongas que están habilitados.

## Cómo encaja

- **NeoPi** conserva el motor y puede ejecutar localmente por sí solo; su interfaz propia es la terminal.
- **[NeoCode](https://github.com/CooperbitQuarxs/neocode)** ofrece una interfaz gráfica y hoy puede usar una instancia local de NeoPi sin NeoCore.
- **NeoCore** es una dirección futura: un servicio sin interfaz basado en código del motor, todavía no implementado. La idea es que las interfaces puedan conectarse a trabajo local o a un servicio local/remoto, sin quitarle a NeoPi su ejecución local.
- **NeoProxy** es la puerta de acceso a modelos; **NeoDeck** apunta a ser un tablero web de equipo. La puesta en marcha de oficina y la conexión entre servicios son futuras, no algo ya configurado por este documento.

El [panorama general y guía de primera tarea](./docs/panorama-general.md) explica modelos, agentes, evidencia, permisos y la dirección del sistema con más profundidad.

## Repositorio y licencia

Este repositorio de Cooperbit es el espejo para el equipo. El desarrollo activo, [pull requests](https://github.com/PsychedelicShayna/neopi/pulls?q=is%3Apr) e [issues](https://github.com/PsychedelicShayna/neopi/issues?q=is%3Aissue) están en [PsychedelicShayna/neopi](https://github.com/PsychedelicShayna/neopi); el proyecto deriva de [oh-my-pi](https://github.com/can1357/oh-my-pi). La presencia de código o releases en el espejo no garantiza que cada versión esté aprobada para el equipo.

El código está bajo licencia **MIT** (ver [LICENSE](./LICENSE)); se conservan los avisos de copyright y de terceros ([THIRD-PARTY-NOTICES.txt](./THIRD-PARTY-NOTICES.txt)).
