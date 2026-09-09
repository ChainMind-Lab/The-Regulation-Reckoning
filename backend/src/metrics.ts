/**
 * Minimal Prometheus-format metrics registry.
 *
 * Tracks HTTP traffic, upstream reachability (Horizon / Soroban RPC), data
 * ingestion runs and indexed events. Exposed at GET /metrics in text format
 * so any Prometheus/OTLP scraper can collect it.
 */

type Counter = { value: number };
type Histogram = { buckets: number[]; counts: number[]; sum: number; count: number };

function makeCounter(): Counter {
  return { value: 0 };
}

function makeHistogram(buckets: number[]): Histogram {
  return { buckets, counts: buckets.map(() => 0), sum: 0, count: 0 };
}

const counters: Record<string, Counter> = {};
const histograms: Record<string, Histogram> = {};
const gauges: Record<string, { value: number }> = {};

export const metrics = {
  counter(name: string, labels?: Record<string, string>): string {
    return metricKey(name, labels);
  },

  inc(name: string, labels?: Record<string, string>, by = 1): void {
    const key = metricKey(name, labels);
    counters[key] ??= makeCounter();
    counters[key].value += by;
  },

  setGauge(name: string, value: number): void {
    gauges[name] ??= { value: 0 };
    gauges[name].value = value;
  },

  /** Record a duration (ms) into the given histogram. */
  observe(name: string, ms: number, labels?: Record<string, string>): void {
    const key = metricKey(name, labels);
    histograms[key] ??= makeHistogram([5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]);
    const h = histograms[key];
    h.sum += ms;
    h.count += 1;
    for (let i = 0; i < h.buckets.length; i += 1) {
      if (ms <= h.buckets[i]) {
        h.counts[i] += 1;
        break;
      }
    }
  },

  render(): string {
    const lines: string[] = [];
    for (const [key, c] of Object.entries(counters)) {
      const { name, labels } = parseKey(key);
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name}${labels} ${c.value}`);
    }
    for (const [key, g] of Object.entries(gauges)) {
      lines.push(`# TYPE ${key} gauge`);
      lines.push(`${key} ${g.value}`);
    }
    for (const [key, h] of Object.entries(histograms)) {
      const { name, labels } = parseKey(key);
      lines.push(`# TYPE ${name} histogram`);
      lines.push(`${name}_count${labels} ${h.count}`);
      lines.push(`${name}_sum${labels} ${Math.round(h.sum * 100) / 100}`);
      for (let i = 0; i < h.buckets.length; i += 1) {
        lines.push(`${name}_bucket${labels}{le="${h.buckets[i]}"} ${h.counts[i]}`);
      }
    }
    return lines.join('\n') + '\n';
  },
};

function metricKey(name: string, labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return name;
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`);
  return `${name}{${parts.join(',')}}`;
}

function parseKey(key: string): { name: string; labels: string } {
  const idx = key.indexOf('{');
  if (idx === -1) return { name: key, labels: '' };
  return { name: key.slice(0, idx), labels: key.slice(idx) };
}
