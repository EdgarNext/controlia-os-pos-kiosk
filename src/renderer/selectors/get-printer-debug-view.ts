import type { AppState } from '../state/app-state';

type PrinterDebugView = {
  logsJoined: string;
};

let lastKey = '';
let lastValue: PrinterDebugView = { logsJoined: '' };

export function getPrinterDebugView(state: AppState): PrinterDebugView {
  const key = `${state.printer.version}|${state.printerDebugLogs.length}`;
  if (key === lastKey) return lastValue;

  lastKey = key;
  lastValue = {
    logsJoined: state.printerDebugLogs.join('\n'),
  };
  return lastValue;
}
