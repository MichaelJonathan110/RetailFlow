import { describe, expect, it } from 'vitest';
import { formatBytes, formatCurrency, formatDuration, formatNumber, formatPercent, severityTone, statusTone } from './format';

describe('formatNumber', () => {
  it('formats numbers and handles blanks', () => {
    expect(formatNumber(1234)).toBe('1,234');
    expect(formatNumber('12.5', 1)).toBe('12.5');
    expect(formatNumber(null)).toBe('-');
    expect(formatNumber('not-a-number')).toBe('-');
  });
});

describe('formatCurrency', () => {
  it('renders BRL and guards against garbage', () => {
    expect(formatCurrency(10)).toContain('10.00');
    expect(formatCurrency(undefined)).toBe('-');
  });
});

describe('formatPercent', () => {
  it('treats input as a ratio', () => {
    expect(formatPercent(0.9871)).toBe('98.7%');
    expect(formatPercent(null)).toBe('-');
  });
});

describe('formatDuration', () => {
  it('scales the unit', () => {
    expect(formatDuration(450)).toBe('450 ms');
    expect(formatDuration(2500)).toBe('2.5 s');
    expect(formatDuration(120000)).toBe('2.0 min');
  });
});

describe('formatBytes', () => {
  it('scales the unit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
  });
});

describe('statusTone', () => {
  it('maps backend statuses onto badge tones', () => {
    expect(statusTone('completed')).toBe('success');
    expect(statusTone('passed')).toBe('success');
    expect(statusTone('failed')).toBe('danger');
    expect(statusTone('completed_with_rejects')).toBe('warning');
    expect(statusTone('running')).toBe('warning');
    expect(statusTone('something-else')).toBe('neutral');
    expect(statusTone(null)).toBe('neutral');
  });
});

describe('severityTone', () => {
  it('maps severities', () => {
    expect(severityTone('critical')).toBe('danger');
    expect(severityTone('high')).toBe('warning');
    expect(severityTone('medium')).toBe('info');
    expect(severityTone('low')).toBe('neutral');
  });
});
