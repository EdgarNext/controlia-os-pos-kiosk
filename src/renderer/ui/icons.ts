function baseIcon(path: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="${path}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function iconGear(): string {
  return baseIcon('M4 7h8M15 7h5M9 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM4 12h5M11 12h9M13 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM4 17h11M18 17h2M20 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z');
}

export function iconSync(): string {
  return baseIcon('M20 5v5h-5M4 19v-5h5M19 10a7 7 0 0 0-12-2M5 14a7 7 0 0 0 12 2');
}

export function iconSun(): string {
  return baseIcon('M12 4V2m0 20v-2m8-8h2M2 12h2m11.3 5.3 1.4 1.4M7.3 7.3 5.9 5.9m0 12.8 1.4-1.4m9.9-9.9 1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z');
}

export function iconMoon(): string {
  return baseIcon('M21 12.8A8.5 8.5 0 1 1 11.2 3a7 7 0 1 0 9.8 9.8Z');
}

export function iconTable(): string {
  return baseIcon('M3 7.5h18M5 7.5V19m14-11.5V19M8.5 11.5h7M7 19h10');
}

export function iconUser(): string {
  return baseIcon('M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm-8 8a8 8 0 0 1 16 0');
}

export function iconPrinter(): string {
  return baseIcon('M7 9V4h10v5M6 17h12v3H6v-3Zm-2-2V10h16v5M17 13h.01');
}

export function iconTag(): string {
  return baseIcon('M20 12 12 20 4 12l8-8h8v8Z M16 8h.01');
}

export function iconHistory(): string {
  return baseIcon('M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4M12 8v5l3 2');
}

export function iconScan(): string {
  return baseIcon('M4 7V5a1 1 0 0 1 1-1h2M20 7V5a1 1 0 0 0-1-1h-2M4 17v2a1 1 0 0 0 1 1h2M20 17v2a1 1 0 0 1-1 1h-2M8 12h8');
}

export function iconKitchen(): string {
  return baseIcon('M4 3v8M7 3v8M5.5 11v10M14 3a4 4 0 0 1 4 4v14M18 3v18');
}

export function iconReceipt(): string {
  return baseIcon('M7 3h10v18l-2-1-2 1-2-1-2 1-2-1-2 1V3Zm3 5h4M10 11h4M10 14h3');
}

export function iconInspect(): string {
  return baseIcon('M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z');
}

export function iconBanknote(): string {
  return baseIcon('M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm3 2a2 2 0 0 0-2 2m14-2a2 2 0 0 1 2 2m-8-1v4m0 0h.01');
}

export function iconCreditCard(): string {
  return baseIcon('M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 3h18M7 15h4');
}

export function iconBackspace(): string {
  return baseIcon('M21 5H9l-6 7 6 7h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2ZM11 10l4 4m0-4-4 4');
}

export function iconClear(): string {
  return baseIcon('M4 6h16M9 6V4h6v2m-8 0 1 14h8l1-14');
}

export function iconCategory(): string {
  return baseIcon('M4 5.5h7v7H4zM13 5.5h7v7h-7zM4 13.5h7v7H4zM13 13.5h7v7h-7z');
}

export function iconCoffeeCup(): string {
  return baseIcon('M5 9h10v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9Zm10 1h2a2 2 0 1 1 0 4h-2M8 4v2m4-2v2');
}

export function iconBurger(): string {
  return baseIcon('M4 11h16M5 15h14M6 18h12M6 11a6 6 0 0 1 12 0M8.5 13h.01M12 13h.01M15.5 13h.01');
}

export function iconPizza(): string {
  return baseIcon('M4 5c5 3 11 3 16 0l-8 15L4 5Zm8 7h.01M9.5 10h.01M14.5 10h.01');
}

export function iconIceCream(): string {
  return baseIcon('M12 4a4 4 0 0 1 4 4v2h-8V8a4 4 0 0 1 4-4Zm-3 6h6l-2.2 10h-1.6L9 10Z');
}

export function iconDrink(): string {
  return baseIcon('M7 4h10l-1.8 16h-6.4L7 4Zm3 0V2m4 2V2');
}
