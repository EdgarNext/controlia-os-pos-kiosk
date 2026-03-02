type Histogram = {
  count: number;
  maxMs: number;
  samples: number[];
};

const MAX_SAMPLES = 1000;
const histograms = new Map<string, Histogram>();

function getHistogram(name: string): Histogram {
  const existing = histograms.get(name);
  if (existing) return existing;

  const created: Histogram = {
    count: 0,
    maxMs: 0,
    samples: [],
  };
  histograms.set(name, created);
  return created;
}

export function mark(name: string): number {
  const ts = performance.now();
  try {
    performance.mark(name);
  } catch {
    // Ignore unsupported mark names.
  }
  return ts;
}

export function measure(name: string, start: number, end: number): number {
  const duration = Math.max(0, end - start);
  trackDuration(name, duration);
  try {
    performance.measure(name, { start, end, duration });
  } catch {
    // Keep custom metrics as source of truth.
  }
  return duration;
}

export function trackDuration(name: string, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const histogram = getHistogram(name);
  histogram.count += 1;
  histogram.maxMs = Math.max(histogram.maxMs, ms);
  histogram.samples.push(ms);
  if (histogram.samples.length > MAX_SAMPLES) {
    histogram.samples.splice(0, histogram.samples.length - MAX_SAMPLES);
  }
}

function percentile(samples: number[], p: number): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function reportEvery(name: string, nRenders: number): string | null {
  const histogram = histograms.get(name);
  if (!histogram || histogram.count <= 0) return null;
  if (nRenders <= 0 || histogram.count % nRenders !== 0) return null;

  const p50 = percentile(histogram.samples, 50);
  const p95 = percentile(histogram.samples, 95);
  const p99 = percentile(histogram.samples, 99);

  return `${name} count=${histogram.count} p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms p99=${p99.toFixed(2)}ms max=${histogram.maxMs.toFixed(2)}ms`;
}
