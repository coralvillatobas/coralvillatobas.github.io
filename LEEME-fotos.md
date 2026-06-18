# Cómo usar el sistema de fotos y vídeos (arrastrar y soltar)

## Cada vez que quieras trabajar en las fotos de la web

1. Haz doble clic en `iniciar-web.bat` (está en esta misma carpeta).
   Se abrirá una ventanita negra (el servidor, no la toques) y tu navegador
   con la web en `http://localhost:8000` — esto es importante: a partir de
   ahora abre la web siempre así, no con doble clic sobre `index.html`.

2. La primera vez verás un botón rojo abajo a la izquierda que dice
   "Conectar carpeta de medios". Púlsalo y, en el selector que se abre,
   elige la carpeta `coral` (la misma que contiene este archivo y
   `index.html`). El navegador te pedirá permiso una vez: acéptalo.

3. Ya está. Ahora puedes abrir tu carpeta de fotos en el Explorador de
   Windows y arrastrar cualquier imagen o vídeo encima de un hueco vacío
   de la web. Se recorta y se coloca solo, y queda guardado de verdad
   dentro de `coral/media/`.

## Cosas a saber

- Si te equivocas de foto, arrastra otra encima del mismo hueco: sustituye
  a la anterior automáticamente.
- Haz clic en cualquier foto o vídeo ya colocado para verlo en grande.
- Cada vez que cierres el navegador del todo (todas las pestañas) y vuelvas
  a abrir la web, tendrás que pulsar una vez el botón "Reconectar carpeta
  de medios" — no hace falta volver a elegir la carpeta, solo confirmar
  el permiso con un clic.
- Esto solo funciona en Edge, Chrome o navegadores similares (no en
  Firefox).
- No borres ni renombres la carpeta `media/` a mano: ahí es donde se
  guardan las fotos y vídeos reales, junto con un archivo `manifest.json`
  que recuerda qué foto va en qué hueco.

## Editar textos (fechas, títulos, descripciones...)

En las tarjetas de "Próximas actuaciones" y "Conciertos destacados" de la
página Conciertos, todo el texto es editable:

- Haz **doble clic** sobre la fecha, el lugar, el título o la descripción
  para escribir el texto nuevo. Pulsa Intro (o haz clic fuera) para
  guardar, o Escape para cancelar.
- Haz **un clic normal** sobre la etiqueta "Próximamente" / "Realizado"
  para alternar entre los dos estados.
- Todo se guarda igual que las fotos: dentro de `media/content.json`,
  de forma permanente.

## Cambiar los vídeos de YouTube

En la página Multimedia, cada una de las 3 tarjetas de vídeo tiene un
lapicito (aparece al pasar el ratón por encima de la miniatura) que abre
una ventana para pegar el enlace del vídeo de YouTube que quieras (vale
cualquier formato: `youtube.com/watch?v=...`, `youtu.be/...`, etc.).

- Una vez guardado, al hacer clic en la tarjeta el vídeo se reproduce
  ahí mismo, en grande, sin salir de la web.
- Si no arrastras una foto personalizada encima, se usa automáticamente
  la miniatura oficial del vídeo de YouTube.
- El título y la descripción de debajo se editan igual que en Conciertos:
  doble clic para escribir el texto que quieras.
