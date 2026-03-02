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
- `PRINTER_DEVICE_PATH`
- `PRINTER_SHARE`
- `ELECTRON_OPEN_DEVTOOLS`

### Example `config.env`

```env
POS_SYNC_API_BASE_URL=https://your-api.example.com
HUB_API_BASE_URL=https://your-hub.example.com
PRINTER_DEVICE_PATH=/dev/pos58
PRINTER_SHARE=\\\\PC\\EPSON
ELECTRON_OPEN_DEVTOOLS=0
```

### Notes

- Do not ship secrets inside the packaged app.
- Operators can update `config.env` without rebuilding the installer.

## Linux Direct Printing Setup

Linux printing now writes ESC/POS bytes directly to the USB character device. It does not use CUPS, `lp`, queues, or PPD.

### Goal

Fix these warnings in `Printer Debug`:

- `Current user is not in group posprint.`
- `Symlink /dev/pos58 is missing.`

### Step 1: identify printer USB IDs

```bash
lsusb
```

Find your thermal printer line and note:

- `idVendor` (for example `0416`)
- `idProduct` (for example `5011`)

### Step 2A: Linux Mint / Ubuntu

Create `/etc/udev/rules.d/99-pos58-thermal.rules`:

```udev
KERNEL=="lp[0-9]*", SUBSYSTEM=="usbmisc", ATTRS{idVendor}=="XXXX", ATTRS{idProduct}=="YYYY", MODE="0660", GROUP="posprint", SYMLINK+="pos58"
```

Replace `XXXX` and `YYYY` with your real IDs.

### Step 2B: Raspberry Pi OS

Create `/etc/udev/rules.d/99-pos58-thermal.rules`:

```udev
KERNEL=="lp[0-9]*", SUBSYSTEM=="usbmisc", ATTRS{idVendor}=="XXXX", ATTRS{idProduct}=="YYYY", MODE="0660", GROUP="posprint", SYMLINK+="pos58"
```

Use the same format; only IDs change per printer.

### Step 3: create group and add kiosk user

```bash
sudo groupadd -f posprint
sudo usermod -aG posprint $USER
```

If your kiosk runs with another user (for example `pi` on Raspberry Pi OS), add that user explicitly:

```bash
sudo usermod -aG posprint pi
```

### Step 4: reload udev and reconnect printer

```bash
sudo udevadm control --reload-rules
sudo udevadm trigger
```

Unplug/replug the printer USB cable.

### Step 5: re-login

Close session and login again (or reboot). Group changes do not apply to existing sessions.

### Verify

```bash
lsusb
ls -l /dev/pos58
ls -l /dev/usb/lp*
groups
```

Expected:

- `/dev/pos58` exists
- group is `posprint`
- your current user is listed in `groups` output with `posprint`

### In-app testing

- Open `Printer Debug / Testing`.
- Confirm `/dev/pos58` exists and is writable.
- Run `Print Self-Test`.
- Run `Print custom text`.

### Troubleshooting

- If `Current user is not in group posprint` persists:
  run `groups`, confirm your session user, then re-login/reboot.
- If `Symlink /dev/pos58 is missing` persists:
  verify IDs from `lsusb`, then confirm rule filename is exactly `99-pos58-thermal.rules`.
- If printing works but warning remains:
  app is likely using fallback `/dev/usb/lp*`; setup is functional but not standardized.
- If permission denied:
  confirm `ls -l /dev/pos58` shows group `posprint` and group write bit (`rw` for group).

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
