// src/content/content-script.ts
import { Lang, RivenDictionary, OcrRivenResult } from '../shared/types';
import { detectLangFromUrl } from '../shared/dictionary';
import { fillAuctionForm } from './form-filler';

async function loadDictionary(): Promise<RivenDictionary> {
  // 通过 background script 获取字典，避免 content script 中 fetch 失败的问题
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_DICTIONARY' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response && response.ok) {
        resolve(response.data);
      } else {
        reject(new Error(response?.error || '获取字典失败'));
      }
    });
  });
}

console.log('[Riven OCR] content script loaded on', location.href);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FILL_AUCTION_FORM') {
    // 必须返回 true 来启用异步响应
    (async () => {
      try {
        console.log('[Riven OCR] Received fill request:', message.payload);

        const ocr: OcrRivenResult = message.payload;
        const lang: Lang = detectLangFromUrl(location.href);
        
        console.log('[Riven OCR] Detected language:', lang);
        console.log('[Riven OCR] Loading dictionary...');
        const dict = await loadDictionary();
        console.log('[Riven OCR] Dictionary loaded successfully');

        await fillAuctionForm(ocr, dict, lang);

        console.log('[Riven OCR] Form filling completed successfully');
        sendResponse({ ok: true });
      } catch (error) {
        console.error('[Riven OCR] Fill form error:', error);
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        sendResponse({ ok: false, error: errorMessage });
      }
    })();
    return true; // 启用异步响应
  }
  return false;
});
