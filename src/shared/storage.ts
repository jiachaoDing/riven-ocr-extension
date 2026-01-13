// src/shared/storage.ts
import type { OcrRivenResult } from './types';

export interface SyncSettings {
  backendUrl: string;
  marketPriceUrl: string;
  autoFillRows: boolean;
  autoOpenModal: boolean;
  theme: 'light' | 'dark' | 'system';
}

export interface LocalData {
  lastResult?: OcrRivenResult;
  history?: OcrRivenResult[];
  dictionary?: any; // 缓存的字典数据
}

const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  backendUrl: 'http://49.234.200.196:80',
  marketPriceUrl: 'https://lab.webutilitykit.com', 
  autoFillRows: true,
  autoOpenModal: true,
  theme: 'system'
};

// Sync Storage - 多设备同步的配置
export async function getSyncSettings(): Promise<SyncSettings> {
  const result = await chrome.storage.sync.get(DEFAULT_SYNC_SETTINGS as any);
  return result as unknown as SyncSettings;
}

export async function setSyncSettings(settings: Partial<SyncSettings>): Promise<void> {
  await chrome.storage.sync.set(settings);
}

export async function getBackendUrl(): Promise<string> {
  const settings = await getSyncSettings();
  return settings.backendUrl;
}

// Local Storage - 本地缓存数据
export async function getLastResult(): Promise<OcrRivenResult | null> {
  const result = await chrome.storage.local.get(['lastResult']);
  return (result.lastResult as OcrRivenResult | null) || null;
}

export async function setLastResult(result: OcrRivenResult): Promise<void> {
  // 同时保存到历史记录
  const history = await getHistory();
  history.unshift(result);
  // 只保留最近10条记录
  if (history.length > 10) {
    history.splice(10);
  }

  await chrome.storage.local.set({
    lastResult: result,
    history: history
  });
}

export async function getHistory(): Promise<OcrRivenResult[]> {
  const result = await chrome.storage.local.get(['history']);
  return (result.history as OcrRivenResult[]) || [];
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(['history']);
}

export async function getCachedDictionary(): Promise<any | null> {
  const result = await chrome.storage.local.get(['dictionary']);
  return result.dictionary || null;
}

export async function setCachedDictionary(dict: any): Promise<void> {
  await chrome.storage.local.set({ dictionary: dict });
}

export async function clearCache(): Promise<void> {
  await chrome.storage.local.clear();
}

// 工具函数
export async function testBackendConnection(url: string): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(`${url}/health/`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      return { success: true, message: '后端连接正常' };
    } else {
      return { success: false, message: `HTTP ${response.status}: ${response.statusText}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return { success: false, message: `连接失败: ${message}` };
  }
}