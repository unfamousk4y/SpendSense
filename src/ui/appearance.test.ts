import { describe, expect, test } from 'vitest';
import { applyPreset, DEFAULT_EFFECTS, parseEffects, presetOf, withControl } from './appearance';

describe('effects presets', () => {
  test('new users start on Subtle', () => {
    expect(presetOf(DEFAULT_EFFECTS)).toBe('subtle');
    expect(parseEffects(null)).toEqual(DEFAULT_EFFECTS);
  });

  test.each(['off', 'subtle', 'full'] as const)('%s is recognised after being applied', (preset) => {
    expect(presetOf(applyPreset(preset))).toBe(preset);
  });

  test('Off turns every effect off', () => {
    const { background, tilt, edgeMotion, chartAnimation } = applyPreset('off');
    expect([background, tilt, edgeMotion, chartAnimation]).toEqual([false, false, false, false]);
  });

  test('changing one switch shows Custom, and undoing it returns to the preset', () => {
    const changed = withControl(applyPreset('full'), 'tilt', false);
    expect(presetOf(changed)).toBe('custom');
    expect(presetOf(withControl(changed, 'tilt', true))).toBe('full');
  });

  test('turning every switch off one by one reads as Off', () => {
    const settings = (['background', 'tilt', 'edgeMotion', 'chartAnimation'] as const).reduce(
      (current, control) => withControl(current, control, false),
      applyPreset('subtle'),
    );
    expect(presetOf(settings)).toBe('off');
  });
});

describe('reading stored effects', () => {
  test('a stored choice comes back exactly', () => {
    const custom = withControl(applyPreset('full'), 'edgeMotion', false);
    expect(parseEffects(JSON.stringify(custom))).toEqual(custom);
  });

  test.each([
    ['not JSON', 'nope'],
    ['a number', '5'],
    ['null', 'null'],
    ['a missing switch', '{"background":true,"tilt":true,"edgeMotion":true}'],
    ['a switch of the wrong type', '{"background":"yes","tilt":true,"edgeMotion":true,"chartAnimation":true}'],
  ])('%s falls back to the default', (_name, text) => {
    expect(parseEffects(text)).toEqual(DEFAULT_EFFECTS);
  });

  test('an unknown strength reads as subtle', () => {
    const text = '{"background":true,"tilt":true,"edgeMotion":true,"chartAnimation":true,"level":"max"}';
    expect(parseEffects(text).level).toBe('subtle');
  });
});
