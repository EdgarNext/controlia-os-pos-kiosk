type TextOptions = {
  align?: 'left' | 'center' | 'right';
  em?: boolean;
  width?: 1 | 2 | 3 | 4;
  height?: 1 | 2 | 3 | 4;
  lang?: 'en' | 'es';
  smooth?: boolean;
  font?: 'font_a' | 'font_b';
};

type ImageOptions = {
  width: number;
  height: number;
  align?: 'left' | 'center' | 'right';
  color?: 'color_1' | 'color_2' | 'color_3' | 'color_4';
  mode?: 'mono' | 'gray16';
};

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    .replaceAll('\n', '&#10;');
}

function attrs(attributes: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ` ${key}="${String(value)}"`)
    .join('');
}

export function text(content: string, options?: TextOptions): string {
  const normalized = content.endsWith('\n') ? content : `${content}\n`;
  return `<text${attrs({
    align: options?.align,
    em: options?.em ? 'true' : undefined,
    width: options?.width,
    height: options?.height,
    lang: options?.lang,
    smooth: options?.smooth ? 'true' : undefined,
    font: options?.font,
  })}>${escapeXml(normalized)}</text>`;
}

export function image(base64Raster: string, options: ImageOptions): string {
  return `<image${attrs({
    width: Math.max(8, Math.floor(options.width)),
    height: Math.max(1, Math.floor(options.height)),
    align: options.align,
    color: options.color,
    mode: options.mode,
  })}>${base64Raster}</image>`;
}

export function feed(lines = 1): string {
  return `<feed${attrs({ line: Math.max(1, Math.floor(lines)) })}/>`;
}

export function cut(type: 'feed' | 'no_feed' = 'feed'): string {
  return `<cut${attrs({ type })}/>`;
}

export function pulse(drawer: 'drawer_1' | 'drawer_2' = 'drawer_1'): string {
  return `<pulse${attrs({ drawer })}/>`;
}

export function separator(width = 32): string {
  return text('-'.repeat(Math.max(8, width)));
}

export function eposDocument(nodes: string[]): string {
  return `<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">${nodes.join('')}</epos-print>`;
}
