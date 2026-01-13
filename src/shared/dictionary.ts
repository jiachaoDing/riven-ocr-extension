// src/shared/dictionary.ts
import type { Lang, RivenDictionary, DictEntry } from './types';

let dictCache: RivenDictionary | null = null;

export async function loadDictionary(): Promise<RivenDictionary> {
  if (dictCache) return dictCache;
  const res = await fetch(chrome.runtime.getURL('data/dictionary.json'));
  dictCache = await res.json();
  return dictCache!;
}

export function detectLangFromUrl(url: string): Lang {
  return url.includes('/zh-hans/') ? 'zh' : 'en';
}

export function getWeaponEntry(
  ocrWeaponUrlName: string | undefined,
  ocrWeaponName: string | undefined,
  dict: RivenDictionary
): DictEntry | null {
  if (ocrWeaponUrlName && dict.weapon_dict[ocrWeaponUrlName]) {
    return dict.weapon_dict[ocrWeaponUrlName];
  }
  if (!ocrWeaponName) return null;

  const target = normalize(ocrWeaponName);
  let best: { entry: DictEntry | null; score: number } = { entry: null, score: 0 };

  for (const entry of Object.values(dict.weapon_dict)) {
    for (const name of [...entry.names.en, ...entry.names.zh]) {
      const n = normalize(name);
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

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+|·|\./g, '');
}
