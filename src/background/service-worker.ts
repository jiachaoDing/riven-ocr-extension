// src/background/service-worker.ts
import type { OcrRivenResult } from '../shared/types';
import { getBackendUrl, getLastResult, setLastResult } from '../shared/storage';

console.log('[Riven OCR] Service worker loaded');

interface MessageResponse {
  ok: boolean;
  data?: OcrRivenResult;
  error?: string;
  detail?: string;
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Riven OCR] Extension installed');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'PARSE_IMAGE_BASE64') {
    handleParseImageBase64(message.payload.base64)
      .then((result) => sendResponse(result))
      .catch((error) => {
        console.error('[Riven OCR] OCR parse error:', error);
        sendResponse({
          ok: false,
          error: 'OCR 解析失败',
          detail: error.message || '未知错误'
        });
      });
    return true; // 异步响应
  }

  if (message.type === 'GET_LAST_RESULT') {
    getLastResult()
      .then((result) => sendResponse({ ok: true, data: result }))
      .catch((error) => sendResponse({ ok: false, error: '获取缓存结果失败' }));
    return true;
  }

  if (message.type === 'GET_BACKEND_URL') {
    getBackendUrl()
      .then((url) => sendResponse(url))
      .catch((error) => sendResponse(null));
    return true;
  }

  if (message.type === 'GET_DICTIONARY') {
    loadDictionaryForContentScript()
      .then((dict) => sendResponse({ ok: true, data: dict }))
      .catch((error) => sendResponse({ ok: false, error: '获取字典失败' }));
    return true;
  }

  if (message.type === 'HEALTH_CHECK') {
    handleHealthCheck()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: '健康检查失败' }));
    return true;
  }

  return false;
});

async function handleParseImageBase64(base64Image: string): Promise<MessageResponse> {
  try {
    const backendUrl = await getBackendUrl();

    console.log('[Riven OCR] Calling OCR API:', `${backendUrl}/api/v1/riven/parse-base64`);
    const response = await fetch(`${backendUrl}/api/v1/riven/parse-base64`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: base64Image
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data: OcrRivenResult = await response.json();
    console.log('[Riven OCR] OCR result received:', data);

    // 缓存结果
    await setLastResult(data);

    return {
      ok: true,
      data
    };
  } catch (error) {
    console.error('[Riven OCR] API call failed:', error);
    if (error instanceof Error) {
      return {
        ok: false,
        error: '网络请求失败',
        detail: error.message
      };
    }
    return {
      ok: false,
      error: '未知错误',
      detail: '网络请求过程中发生未知错误'
    };
  }
}

async function loadDictionaryForContentScript(): Promise<any> {
  try {
    console.log('[Riven OCR] Loading dictionary for content script...');
    const response = await fetch(chrome.runtime.getURL('data/dictionary.json'));
    const dict = await response.json();
    console.log('[Riven OCR] Dictionary loaded successfully for content script');
    return dict;
  } catch (error) {
    console.error('[Riven OCR] Failed to load dictionary for content script:', error);
    throw error;
  }
}

async function handleHealthCheck(): Promise<MessageResponse> {
  try {
    const backendUrl = await getBackendUrl();

    console.log('[Riven OCR] Health check:', `${backendUrl}/health/`);
    const response = await fetch(`${backendUrl}/health/`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      return { ok: true };
    } else {
      return {
        ok: false,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }
  } catch (error) {
    console.error('[Riven OCR] Health check failed:', error);
    const message = error instanceof Error ? error.message : '未知错误';
    return {
      ok: false,
      error: `连接失败: ${message}`
    };
  }
}
