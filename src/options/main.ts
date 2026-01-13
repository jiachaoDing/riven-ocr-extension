// src/options/main.ts
import { loadDictionary } from '../shared/dictionary';
import { getSyncSettings, setSyncSettings, testBackendConnection } from '../shared/storage';

// DOM 元素
const backendUrlInput = document.getElementById('backend-url') as HTMLInputElement;
const marketPriceUrlInput = document.getElementById('market-price-url') as HTMLInputElement;
const backendStatus = document.getElementById('backend-status') as HTMLDivElement;
const testBackendBtn = document.getElementById('test-backend') as HTMLButtonElement;
const saveBackendBtn = document.getElementById('save-backend') as HTMLButtonElement;

const dictVersion = document.getElementById('dict-version') as HTMLDivElement;
const dictStatus = document.getElementById('dict-status') as HTMLDivElement;
const updateDictBtn = document.getElementById('update-dict') as HTMLButtonElement;

const autoFillRowsCheckbox = document.getElementById('auto-fill-rows') as HTMLInputElement;
const autoOpenModalCheckbox = document.getElementById('auto-open-modal') as HTMLInputElement;
const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
const saveSettingsBtn = document.getElementById('save-settings') as HTMLButtonElement;

// 工具函数
function setStatus(element: HTMLDivElement, message: string, type: 'success' | 'error' | 'info' = 'info') {
  element.textContent = message;
  element.className = `status-badge ${type}`;
}

async function applyTheme(theme: 'light' | 'dark' | 'system') {
  let effectiveTheme = theme;
  if (theme === 'system') {
    effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', effectiveTheme);
}

// 字典相关功能
async function checkDictionaryStatus() {
  try {
    const dict = await loadDictionary();
    const weaponCount = Object.keys(dict.weapon_dict).length;
    const attrCount = Object.keys(dict.attribute_dict).length;

    dictVersion.textContent = `${weaponCount} 武器 / ${attrCount} 属性`;
    setStatus(dictStatus, '加载成功', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    setStatus(dictStatus, `加载失败: ${message}`, 'error');
  }
}

// 初始化
async function initialize() {
  const settings = await getSyncSettings();
  applyTheme(settings.theme);

  backendUrlInput.value = settings.backendUrl;
  autoFillRowsCheckbox.checked = settings.autoFillRows;
  autoOpenModalCheckbox.checked = settings.autoOpenModal;
  themeSelect.value = settings.theme;

  // 检查后端状态
  setStatus(backendStatus, '正在测试...', 'info');
  const backendResult = await testBackendConnection(settings.backendUrl);
  setStatus(backendStatus, backendResult.message, backendResult.success ? 'success' : 'error');

  // 检查字典状态
  await checkDictionaryStatus();
}

// 事件监听器
testBackendBtn.addEventListener('click', async () => {
  setStatus(backendStatus, '测试中...', 'info');
  const result = await testBackendConnection(backendUrlInput.value);
  setStatus(backendStatus, result.message, result.success ? 'success' : 'error');
});

saveBackendBtn.addEventListener('click', async () => {
  await setSyncSettings({ backendUrl: backendUrlInput.value });
  setStatus(backendStatus, '基础配置已保存', 'success');
});

updateDictBtn.addEventListener('click', async () => {
  setStatus(dictStatus, '正在更新...', 'info');
  await chrome.storage.local.remove(['dictionary']);
  await checkDictionaryStatus();
});

saveSettingsBtn.addEventListener('click', async () => {
  const settings = {
    backendUrl: backendUrlInput.value,
    marketPriceUrl: marketPriceUrlInput.value,
    autoFillRows: autoFillRowsCheckbox.checked,
    autoOpenModal: autoOpenModalCheckbox.checked,
    theme: themeSelect.value as 'light' | 'dark' | 'system'
  };

  await setSyncSettings(settings);
  applyTheme(settings.theme);
  alert('设置已保存');
});

// 启动应用
initialize();