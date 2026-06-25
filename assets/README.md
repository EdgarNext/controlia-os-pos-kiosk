# POS Kiosk App Icons

Coloca aqui el set final de iconos de la aplicacion para que Electron Forge lo use en desarrollo y empaquetado.

Archivos esperados:

- `apps/edge/pos-kiosk/assets/icon.png`
- `apps/edge/pos-kiosk/assets/icon.ico`
- `apps/edge/pos-kiosk/assets/icon.icns`

Uso previsto:

- `icon.png`: ventana Electron en Linux y makers Linux.
- `icon.ico`: binario e instalador de Windows.
- `icon.icns`: app empaquetada en macOS.

Si aun no existe el asset final:

- En desarrollo, la ventana usa temporalmente `src/assets/controlia-mark.svg` como fallback visual.
- Los artefactos empaquetados solo tomaran icono propio cuando existan estos archivos.

Recomendaciones del asset fuente:

- fuente maestra cuadrada, sin transparencias accidentales
- base minima: `1024x1024`
- exportar tambien tamaños comunes `512`, `256`, `128`, `64`, `48`, `32`, `16`

Comandos sugeridos si generas derivados localmente con ImageMagick:

```bash
magick icon-source.png -resize 1024x1024 assets/icon.png
magick icon-source.png -define icon:auto-resize=256,128,64,48,32,16 assets/icon.ico
```

Para `icon.icns`, puedes generarlo desde un `iconset` en macOS:

```bash
iconutil -c icns AppIcon.iconset -o assets/icon.icns
```

Despues de agregar o actualizar iconos:

1. ejecuta `npm start` para validar el icono en dev;
2. ejecuta `npm run package` o `npm run make` para validar artefactos empaquetados.
