# Panorama general: trabajar con agentes

Esta guía sirve para empezar con NeoPi o NeoCode y para entender hacia dónde se propone llevar el sistema. Distingue lo disponible hoy de las ideas futuras: no es un compromiso de implementación ni de despliegue.

## Cuatro conceptos

- Un **modelo de lenguaje** genera respuestas a partir del contexto; puede equivocarse y no conoce automáticamente tus archivos ni las reglas del negocio.
- El **harness** es el programa que conecta el modelo con instrucciones, contexto, herramientas, permisos y ciclos de trabajo. Sus capacidades y límites importan tanto como el pedido.
- Un **agente** combina modelo y harness para avanzar hacia un objetivo: puede consultar evidencia y, si tiene herramientas y permiso, hacer cambios. No sustituye el criterio profesional.
- Una **interfaz** permite orientar y observar ese trabajo. NeoPi ofrece terminal; NeoCode, una interfaz gráfica. No hay que confundir la ventana con el motor que trabaja detrás.

## Primera tarea: pedido → evidencia → iteración

Elegí un proyecto al que tengas acceso y una pregunta que tenga una respuesta verificable. Por ejemplo:

> En este proyecto, identificá dónde se valida el ingreso de clientes. Explicá el recorrido con rutas de archivos y fragmentos relevantes, señalá lo que no puedas comprobar y no modifiques archivos ni ejecutes comandos que cambien datos.

1. Abrí el proyecto en NeoPi o NeoCode, elegí un modelo al que tengas acceso y enviá el pedido. Incluí el resultado buscado, contexto de negocio, alcance y restricciones; no hace falta dictar cada paso.
2. Contrastá las rutas y explicaciones con los archivos. Si falta evidencia, pedí que profundice o corrija. Una respuesta convincente no es una prueba.
3. Cuando entiendas el estado actual, pedí una propuesta acotada y una forma de comprobarla. Autorizá solo las acciones apropiadas; revisá cambios y resultados antes de usarlos o publicarlos.
4. Si aparece un error o un supuesto incorrecto, aportá el dato y repetí el ciclo. Para tareas de negocio, la persona responsable valida reglas, riesgos y resultado.

Evitá incluir credenciales o información sensible sin autorización. Un agente puede leer o modificar recursos según sus permisos: empezá con un alcance mínimo, prestá atención a las confirmaciones y no le concedas acceso que no necesite. Las acciones externas, destructivas o con impacto real requieren especial cuidado.

## El sistema hoy

NeoPi incluye motor de agentes e interfaz de terminal y puede trabajar localmente sin un servicio NeoCore separado. NeoCode puede iniciar y usar NeoPi como proveedor desde su interfaz gráfica. El acceso a modelos requiere configuración y autorización de un proveedor; las cuentas y el acceso de oficina aún deben configurarse. Disponibilidad de código o de un archivo de release no equivale a instalación probada ni a acceso listo.

El conocimiento del dominio sigue siendo esencial: los agentes pueden ayudar a explorar, documentar, construir y revisar, pero no deciden por sí solos si una regla es correcta. Instalar una herramienta no enseña automáticamente a usarla bien. Tampoco se ha decidido ni demostrado una migración de producto fuera de GeneXus.

## Dirección futura, no capacidad ya entregada

Se plantea extraer o compartir código del motor de NeoPi para crear **NeoCore**, un daemon sin interfaz. Su empaquetado y la forma exacta de compartir código siguen sin decidirse. NeoPi conservaría su motor y ejecución local. La intención es que NeoPi y NeoCode puedan conectarse a agentes alojados por la propia aplicación, en un daemon local o en uno remoto; los entornos de NeoCode se adaptarían para elegir destino. Conexiones guardadas permitirían volver al trabajo en curso: el daemon mantendría los agentes y las interfaces podrían conectarse y desconectarse. Esto no describe una funcionalidad NeoCore ya implementada.

En ese modelo los agentes serían pares con roles y plantillas configurables, no especies rígidas. Por ejemplo, un vigilante sin interfaz podría observar y avisar a otros agentes, persistir más allá de quien lo solicitó y evolucionar mediante conversación y una plantilla guardada. Permisos, herramientas y fuentes de mensajes se ajustarían al caso; no hay un protocolo o planificador definitivo aprobado aquí.

La propuesta de oficina combina tres servicios: NeoCore para ejecución, NeoProxy como puerta a modelos y NeoDeck como tablero web de equipo. Se prevé administrar acceso por persona y ofrecer roles como modelos virtuales, sin impedir la elección explícita cuando esté disponible. La configuración de cuentas y servicios está pendiente. El equipo de oficina Utopia Planitia podría alojar trabajo remoto y futuras máquinas virtuales para cargas que requieran Windows; el trabajo local seguiría siendo posible. El acceso remoto previsto usaría HTTPS o WebSocket seguro, con autenticación y autorización aún por definir. No se promete rendimiento ni compatibilidad universal con versiones de GeneXus.

## Para seguir

- [NeoPi](../README.md) y [NeoCode](https://github.com/CooperbitQuarxs/neocode): puntos de entrada y estado de cada interfaz.
- [NeoProxy](https://github.com/CooperbitQuarxs/NeoProxy) y [NeoDeck](https://github.com/CooperbitQuarxs/neodeck): repositorios del gateway y el tablero.
- Como material externo sobre harnesses y pedidos orientados a resultados: [My last video about AI harnesses](https://youtube.com/watch?v=ebILGCoN4UU) y [Your prompts kinda suck](https://youtube.com/watch?v=m-B3jIMMmUE). Son fuentes para pensar, no una adopción integral de sus opiniones; las capacidades del harness y el ciclo de vida de los agentes también importan.
