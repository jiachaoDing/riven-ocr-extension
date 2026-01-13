// tests/dictionary.test.ts
import { describe, it, expect } from 'vitest';
import { getWeaponEntry, detectLangFromUrl, getAttributeEntry } from '../src/shared/dictionary';
import type { RivenDictionary, Lang } from '../src/shared/types';

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
  attribute_dict: {
    critical_chance: {
      url_name: 'critical_chance',
      names: {
        en: ['Critical Chance'],
        zh: ['暴击几率']
      }
    }
  }
};

describe('detectLangFromUrl', () => {
  it('should detect zh for zh-hans URLs', () => {
    expect(detectLangFromUrl('https://warframe.market/zh-hans/auctions')).toBe('zh');
  });

  it('should detect en for other URLs', () => {
    expect(detectLangFromUrl('https://warframe.market/en/auctions')).toBe('en');
    expect(detectLangFromUrl('https://warframe.market/auctions')).toBe('en');
  });
});

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

describe('getAttributeEntry', () => {
  it('should return attribute entry by url_name', () => {
    const entry = getAttributeEntry('critical_chance', mockDict);
    expect(entry?.url_name).toBe('critical_chance');
    expect(entry?.names.en).toContain('Critical Chance');
  });

  it('should return null for non-existent attribute', () => {
    const entry = getAttributeEntry('nonexistent_attr', mockDict);
    expect(entry).toBeNull();
  });
});
