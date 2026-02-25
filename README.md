# controlia-os-pos-kiosk

## Runtime environment configuration

The POS kiosk app reads environment variables at startup from this file name:

`config.env`

Load order:

1. `${app.getPath('userData')}/config.env`
2. Fallback to local `.env` (development only)

### OS paths for `config.env`

- Windows: `C:\Users\<USER>\AppData\Roaming\pos-kiosk\config.env`
- Linux Mint: `/home/<user>/.config/pos-kiosk/config.env`

`pos-kiosk` comes from Electron `app.getName()` for this app.

### Environment variables used by `pos-kiosk`

- `POS_SYNC_API_BASE_URL`
- `HUB_API_BASE_URL`
- `PRINTER_NAME`
- `PRINTER_SHARE`
- `ELECTRON_OPEN_DEVTOOLS`

### Example `config.env`

```env
POS_SYNC_API_BASE_URL=https://your-api.example.com
HUB_API_BASE_URL=https://your-hub.example.com
PRINTER_NAME=EPSON_TM_T20III
PRINTER_SHARE=\\\\PC\\EPSON
ELECTRON_OPEN_DEVTOOLS=0
```

### Notes

- Do not ship secrets inside the packaged app.
- Operators can update `config.env` without rebuilding the installer.

## HID scanner mode (keyboard wedge)

The POS uses HID scanner capture (keyboard wedge) via Electron `before-input-event`.

### HID behavior

- Does not require focus on any input field.
- Does not require pressing Enter.
- If scanner sends Enter, it is accepted as terminator when enabled.
- If scanner does not send Enter, scan finishes on silence gap timeout.
- Uses timing heuristics to distinguish human typing vs scanner bursts.

### Scanner settings (Ajustes UI)

- `Minimo caracteres`
- `Maximo caracteres`
- `Max interkey scan (ms)`
- `Gap fin scan (ms)`
- `Gap humano (ms)`
- `Pattern caracteres permitidos`
- `Enter termina scan` (`Si`/`No`)

### Troubleshooting checklist

- If scan text appears in inputs, increase `Gap fin scan` and ensure sensitive fields use `data-scan-capture=\"off\"`.
- If scans are not detected, increase `Max interkey scan (ms)` and/or `Gap fin scan (ms)`.
- If manual typing is detected as scan, increase `Minimo caracteres` and reduce `Max interkey scan (ms)`.
- Open `Scanner debug` (or shortcut `Ctrl+Alt+D`) to inspect recent scans and logs.
