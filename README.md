# ControlOBS

## Usar como aplicación de Windows

Instalá `ControlOBS Setup 1.0.0.exe`. No hace falta instalar Node.js en la PC donde se use la aplicación.

Al abrir ControlOBS se inicia el servidor local y aparece el panel de control. Mantené la aplicación abierta mientras OBS esté usando el overlay. En OBS, agregá una fuente **Navegador** con esta dirección:

```text
http://127.0.0.1:3000/overlay.html
```

Configurá el ancho y alto de la fuente para que coincidan con la resolución elegida en el panel.

En el previo, arrastrá los elementos para moverlos y usá el punto naranja de la esquina para cambiar el tamaño. La opacidad se configura en el editor del elemento; el volumen está disponible en los editores de audio y video. La resolución del overlay y el botón para copiar su URL están debajo del previo. Solo las listas y botoneras inferiores tienen desplazamiento propio.

Para un gafete con ciclo automático, la botonera ofrece **Pausar ciclo** y **Iniciar ciclo**. Al pausarlo podés ocultar el gafete manualmente sin que reaparezca según el temporizador; al reanudarlo continúa el ciclo configurado.

En el editor de pizarras podés borrar el contenido dibujado y usar **Deshacer**/**Rehacer**. Para agregar texto, escribilo en el campo correspondiente, elegí la herramienta **Texto** y hacé clic en el lugar del lienzo donde querés colocarlo. Al activar una pizarra desde su botonera, también queda seleccionada en el previo para continuar editándola.

Los archivos personalizables y la configuración se guardan fuera de la aplicación, en `Documentos\ControlOBS`:

- `audio\`
- `video\`
- `Imagenes\`
- `data\controlobs.json`

Agregá tus medios a esas carpetas y usá **Actualizar lista de archivos** en el panel. Al iniciar por primera vez se copian los medios de ejemplo si todavía no existen; no se sobrescriben tus archivos.

Si ya tenés una configuración en otra instalación, exportala desde el panel anterior e importá ese JSON desde el nuevo panel.

## Ejecutar y empaquetar desde el código fuente

Se necesita Node.js en la PC de desarrollo:

```text
npm install
npm run app
npm run dist
```

`npm run app` abre la versión de desarrollo. `npm run dist` genera el instalador de Windows en `release\ControlOBS Setup 1.0.0.exe`.
