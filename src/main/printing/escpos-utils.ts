const ESC = 0x1b;
const GS = 0x1d;
const INIT = Buffer.from([ESC, 0x40]);
const SELECT_CODEPAGE_CP1252 = Buffer.from([ESC, 0x74, 0x10]);
const DEFAULT_FINAL_FEED_LINES = 5;
const FALLBACK_CHAR_MAP: Record<string, string> = {
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '–': '-',
  '—': '-',
  '…': '...',
  '•': '*',
  '\u00a0': ' ',
};

function stripLeadingInit(buffer: Buffer): Buffer {
  if (buffer.length >= 2 && buffer[0] === ESC && buffer[1] === 0x40) {
    return buffer.subarray(2);
  }
  return buffer;
}

function stripCutCommands(buffer: Buffer): Buffer {
  const out: number[] = [];
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === GS && i + 1 < buffer.length && buffer[i + 1] === 0x56) {
      const mode = i + 2 < buffer.length ? buffer[i + 2] : null;
      const hasExtraByte = mode === 65 || mode === 66;
      i += hasExtraByte ? 3 : 2;
      continue;
    }
    out.push(buffer[i]);
  }
  return Buffer.from(out);
}

function ensureTrailingFeed(buffer: Buffer, minLines: number): Buffer {
  let trailingLf = 0;
  for (let i = buffer.length - 1; i >= 0; i -= 1) {
    if (buffer[i] !== 0x0a) break;
    trailingLf += 1;
  }
  if (trailingLf >= minLines) return buffer;
  return Buffer.concat([buffer, Buffer.from('\n'.repeat(minLines - trailingLf), 'ascii')]);
}

export function normalizeEscPosPayload(rawBuffer: Buffer, minFinalFeedLines = DEFAULT_FINAL_FEED_LINES): Buffer {
  const withoutInit = stripLeadingInit(rawBuffer);
  const withoutCut = stripCutCommands(withoutInit);
  const withFeed = ensureTrailingFeed(withoutCut, minFinalFeedLines);
  return Buffer.concat([INIT, withFeed]);
}

export function buildEscPosTextPayload(text: string, extraLines: string[] = []): Buffer {
  const normalizedText = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = [normalizedText.trimEnd(), ...extraLines.filter((line) => line.trim().length > 0)];
  const body = `${lines.join('\n')}\n`;
  const encodedBody = encodeEscPosLatinText(body);
  return normalizeEscPosPayload(Buffer.concat([SELECT_CODEPAGE_CP1252, encodedBody]));
}

export function encodeEscPosLatinText(input: string): Buffer {
  const sanitized = Array.from(input || '')
    .map((char) => {
      if (FALLBACK_CHAR_MAP[char]) return FALLBACK_CHAR_MAP[char];
      const code = char.codePointAt(0) ?? 0x3f;
      if (code <= 0xff) return char;
      return '?';
    })
    .join('');
  return Buffer.from(sanitized, 'latin1');
}
