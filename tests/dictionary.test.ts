// tests/dictionary.test.ts
import { describe, it, expect } from 'vitest';
import { getWeaponEntry } from '../src/shared/dictionary';
import type { RivenDictionary } from '../src/shared/types';

const mockDict: RivenDictionary = {
  weapon_dict: {
    kuva_bramma: {
      url_name: 'kuva_bramma',
      names: {
        en: ['Kuva Bramma'],
        zh: ['库娃 布拉玛']
      }
    }
  },
  attribute_dict: {}
};

describe('getWeaponEntry', () => {
  it('should match by url_name first', () => {
    const entry = getWeaponEntry('kuva_bramma', undefined, mockDict);
    expect(entry?.url_name).toBe('kuva_bramma');
  });

  it('should fuzzy match by name when url_name missing', () => {
    const entry = getWeaponEntry(undefined, 'Kuva Bramma', mockDict);
    expect(entry?.url_name).toBe('kuva_bramma');
  });

  it('should return null when not found', () => {
    const entry = getWeaponEntry(undefined, 'Nonexistent Weapon', mockDict);
    expect(entry).toBeNull();
  });
});
