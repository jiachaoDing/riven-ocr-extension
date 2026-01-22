(async () => {
  // 动态导入编译后的真正 content-script
  const src = chrome.runtime.getURL('content-script.js');
  await import(src);
})();
