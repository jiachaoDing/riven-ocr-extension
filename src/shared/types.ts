// src/shared/types.ts

export interface DictEntry {
  url_name: string;
  names: {
    en: string[];
    zh: string[];
  };
}

export interface RivenDictionary {
  weapon_dict: Record<string, DictEntry>;
  attribute_dict: Record<string, DictEntry>;
}

export type Lang = 'en' | 'zh';

export interface OcrAttribute {
  url_name: string;
  value: number;
  positive: boolean;
}

export interface OcrRivenResult {
  weapon_url_name?: string;
  weapon_name?: string;
  name?: string;
  mastery_level?: number;
  polarity?: 'madurai' | 'naramon' | 'vazarin' | 'unknown';
  mod_rank?: number;
  attributes: OcrAttribute[];
  type: 'riven';
  confidence: number;
}
