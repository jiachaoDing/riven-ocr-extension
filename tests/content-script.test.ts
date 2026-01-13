// tests/content-script.test.ts
import { describe, it, expect } from 'vitest';
import type { OcrRivenResult, Lang, RivenDictionary } from '../src/shared/types';

function buildWeaponSearchText(ocr: OcrRivenResult, dict: RivenDictionary, lang: Lang): string | null {
  const entry = getWeaponEntry(ocr.weapon_url_name, ocr.weapon_name, dict);
  if (!entry) return null;
  return entry.names[lang][0] || null;
}

function getWeaponEntry(
  ocrWeaponUrlName: string | undefined,
  ocrWeaponName: string | undefined,
  dict: RivenDictionary
) {
  if (ocrWeaponUrlName && dict.weapon_dict[ocrWeaponUrlName]) {
    return dict.weapon_dict[ocrWeaponUrlName];
  }
  if (!ocrWeaponName) return null;

  const target = ocrWeaponName.toLowerCase().replace(/\s+|·|\./g, '');
  let best: { entry: any; score: number } = { entry: null, score: 0 };

  for (const entry of Object.values(dict.weapon_dict)) {
    for (const name of [...entry.names.en, ...entry.names.zh]) {
      const n = name.toLowerCase().replace(/\s+|·|\./g, '');
      if (n === target) return entry;
      if (n.includes(target) || target.includes(n)) {
        const score = Math.min(n.length, target.length);
        if (score > best.score) {
          best = { entry, score };
        }
      }
    }
  }
  return best.entry;
}

const mockDict: RivenDictionary = {
  weapon_dict: {
    kuva_bramma: {
      url_name: 'kuva_bramma',
      names: {
        en: ['Kuva Bramma'],
        zh: ['库娃 布拉玛']
      }
    },
    amprex: {
      url_name: 'amprex',
      names: {
        en: ['Amprex'],
        zh: ['安普雷克斯']
      }
    }
  },
  attribute_dict: {}
};

describe('buildWeaponSearchText', () => {
  it('should return English name for en lang with url_name', () => {
    const ocr: OcrRivenResult = {
      weapon_url_name: 'kuva_bramma',
      type: 'riven',
      confidence: 0.95,
      attributes: []
    };

    const result = buildWeaponSearchText(ocr, mockDict, 'en');
    expect(result).toBe('Kuva Bramma');
  });

  it('should return Chinese name for zh lang with url_name', () => {
    const ocr: OcrRivenResult = {
      weapon_url_name: 'kuva_bramma',
      type: 'riven',
      confidence: 0.95,
      attributes: []
    };

    const result = buildWeaponSearchText(ocr, mockDict, 'zh');
    expect(result).toBe('库娃 布拉玛');
  });

  it('should fuzzy match by weapon_name when url_name missing', () => {
    const ocr: OcrRivenResult = {
      weapon_name: 'Amprex',
      type: 'riven',
      confidence: 0.95,
      attributes: []
    };

    const result = buildWeaponSearchText(ocr, mockDict, 'en');
    expect(result).toBe('Amprex');
  });

  it('should return null when weapon not found', () => {
    const ocr: OcrRivenResult = {
      weapon_name: 'Nonexistent Weapon',
      type: 'riven',
      confidence: 0.95,
      attributes: []
    };

    const result = buildWeaponSearchText(ocr, mockDict, 'en');
    expect(result).toBeNull();
  });
});