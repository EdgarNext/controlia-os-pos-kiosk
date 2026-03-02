# POS Kiosk Renderer Perf

## Objetivo
Agregar observabilidad del renderer sin cambiar contratos funcionales.

## Como habilitar profiling
El profiler de render esta apagado por defecto.

Opciones soportadas (cualquiera activa profiling):
- Vite env: `PROFILE_RENDER=1`
- Runtime env: `process.env.PROFILE_RENDER=1` (si esta expuesto)
- LocalStorage (solo lectura): `profile_render=1` o `true` o `on`

## Que metricas se registran
Las metricas se agregan en memoria y se loguean de forma resumida:
- `render:flush-total` (duracion total por render)
- `render:derive-state` (fase de calculo/derivados antes de patch DOM)
- `render:region:header|categories|products|cart|modals|statusbar`

Resumen periodico:
- cada `50` renders
- formato: `count`, `p50`, `p95`, `p99`, `max`

Alertas de render lento:
- `>16ms`: log informativo `slow-render`
- `>33ms`: log con nivel `warn`

## Leak checks (lifecycle)
El renderer ahora centraliza cleanup de:
- listeners globales (`app` y `document`)
- subscripciones (`onScan`, `onOutboxStatus`)
- timers tracked (`setIntervalTracked`, `setTimeoutTracked`)

### Verificacion recomendada
1. Arrancar la app y abrir/cerrar modales (settings, scanner debug, activation gate).
2. Repetir acciones de sync/login/venta y validar que no se duplican callbacks.
3. Revisar que heartbeat de sesion no corre duplicado tras reinicios de bootstrap.

Comandos utiles:
```bash
rg -n "setInterval|setTimeout|addEventListener|onScan|onOutbox" apps/edge/pos-kiosk/src/renderer.ts
npm run start
```
