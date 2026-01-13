// src/content/content-script.ts

console.log('[Riven OCR] content script loaded on', location.href);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FILL_AUCTION_FORM') {
    console.log('[Riven OCR] Received fill request:', message.payload);
    // TODO: 未来在这里实现自动填表逻辑
    sendResponse({ ok: true });
  }
});
