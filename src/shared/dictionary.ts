// src/shared/dictionary.ts
import type { Lang, RivenDictionary, DictEntry } from './types';
import { getCachedDictionary, setCachedDictionary } from './storage';

let dictCache: RivenDictionary | null = null;

export async function loadDictionary(): Promise<RivenDictionary> {
  if (dictCache) return dictCache;

  // 先尝试从缓存加载
  const cached = await getCachedDictionary();
  if (cached) {
    dictCache = cached;
    return dictCache!;
  }

  // 从文件加载
  const res = await fetch(chrome.runtime.getURL('data/dictionary.json'));
  dictCache = await res.json();

  // 缓存到本地存储
  await setCachedDictionary(dictCache);

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

export function getAttributeEntry(urlName: string, dict: RivenDictionary): DictEntry | null {
  return dict.attribute_dict[urlName] || null;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+|·|\./g, '');
}
