import { describe, it, expect } from 'vitest';
import { metrics } from '../src/metrics';

// The registry is a module singleton, so each test uses a unique metric name to
// stay independent of the others.
describe('metrics.render (Prometheus text format)', () => {
  it('emits cumulative histogram buckets with an +Inf bucket', () => {
    const name = 'test_hist_cumulative';
    metrics.observe(name, 3);
    metrics.observe(name, 7);
    metrics.observe(name, 12);

    const out = metrics.render();
    // Cumulative: 3 <= 5, then 3,7 <= 10, then all three <= 25.
    expect(out).toContain(`${name}_bucket{le="5"} 1`);
    expect(out).toContain(`${name}_bucket{le="10"} 2`);
    expect(out).toContain(`${name}_bucket{le="25"} 3`);
    expect(out).toContain(`${name}_bucket{le="+Inf"} 3`);
    expect(out).toContain(`${name}_count 3`);
    expect(out).toContain(`${name}_sum 22`);
  });

  it('merges labels and `le` correctly for a labelled histogram', () => {
    const name = 'test_hist_labeled';
    metrics.observe(name, 1, { job: 'rpc' });
    metrics.observe(name, 50, { job: 'rpc' });

    const out = metrics.render();
    expect(out).toContain(`${name}_bucket{job="rpc",le="5"} 1`);
    expect(out).toContain(`${name}_bucket{job="rpc",le="50"} 2`);
    expect(out).toContain(`${name}_bucket{job="rpc",le="+Inf"} 2`);
  });

  it('declares each metric type once even with multiple label sets', () => {
    metrics.inc('test_counter_multi', { status: '200' });
    metrics.inc('test_counter_multi', { status: '500' });

    const out = metrics.render();
    const typeLines = out.split('\n').filter((l) => l === `# TYPE test_counter_multi counter`);
    expect(typeLines).toHaveLength(1);
    expect(out).toContain('test_counter_multi{status="200"} 1');
    expect(out).toContain('test_counter_multi{status="500"} 1');
  });

  it('renders gauges with their current value', () => {
    metrics.setGauge('test_gauge_value', 7);
    expect(metrics.render()).toContain('test_gauge_value 7');
  });
});
