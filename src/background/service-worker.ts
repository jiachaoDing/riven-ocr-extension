// src/background/service-worker.ts

console.log('[Riven OCR] Service worker loaded');

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Riven OCR] Extension installed');
});

// 未来这里会监听来自 popup 的消息，调用后端 OCR，然后把结果再发回去
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ ok: true });
  }
  // 返回 true 可以让我们异步调用 sendResponse（后面用得上）
  return false;
});
