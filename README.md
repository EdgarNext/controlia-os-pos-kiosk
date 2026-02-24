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
