// src/options/main.ts
import { loadDictionary } from '../shared/dictionary';
import { getSyncSettings, setSyncSettings, testBackendConnection } from '../shared/storage';

// 使用 shared/storage.ts 中的类型

// DOM 元素
const backendUrlInput = document.getElementById('backend-url') as HTMLInputElement;
const backendStatus = document.getElementById('backend-status') as HTMLDivElement;
const testBackendBtn = document.getElementById('test-backend') as HTMLButtonElement;
const saveBackendBtn = document.getElementById('save-backend') as HTMLButtonElement;

const dictVersion = document.getElementById('dict-version') as HTMLDivElement;
const dictStatus = document.getElementById('dict-status') as HTMLDivElement;
const updateDictBtn = document.getElementById('update-dict') as HTMLButtonElement;

const autoFillRowsCheckbox = document.getElementById('auto-fill-rows') as HTMLInputElement;
const autoOpenModalCheckbox = document.getElementById('auto-open-modal') as HTMLInputElement;
const saveSettingsBtn = document.getElementById('save-settings') as HTMLButtonElement;

// 工具函数
function setStatus(element: HTMLDivElement, message: string, type: 'success' | 'error' | 'info' = 'info') {
  element.textContent = message;
  element.className = `status ${type}`;
}

function showLoading(button: HTMLButtonElement, loadingText: string) {
  button.disabled = true;
  const originalText = button.textContent!;
  button.textContent = loadingText;

  return () => {
    button.disabled = false;
    button.textContent = originalText;
  };
}

async function saveBackendUrl(url: string) {
  await setSyncSettings({ backendUrl: url });
  setStatus(backendStatus, '配置已保存', 'success');
}

// 字典相关功能
async function checkDictionaryStatus() {
  try {
    const dict = await loadDictionary();
    const weaponCount = Object.keys(dict.weapon_dict).length;
    const attrCount = Object.keys(dict.attribute_dict).length;

    dictVersion.textContent = `武器: ${weaponCount} | 属性: ${attrCount}`;
    setStatus(dictStatus, '字典加载成功', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    setStatus(dictStatus, `字典加载失败: ${message}`, 'error');
  }
}

async function updateDictionary() {
  // 这里可以实现从远程更新字典的逻辑
  // 暂时只是重新加载本地字典
  setStatus(dictStatus, '正在更新字典...', 'info');
  try {
    // 清除缓存（需要导入storage函数）
    await chrome.storage.local.remove(['dictionary']);

    // 重新加载
    await checkDictionaryStatus();
    setStatus(dictStatus, '字典已更新', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    setStatus(dictStatus, `字典更新失败: ${message}`, 'error');
  }
}

// 初始化
async function initialize() {
  // 加载设置
  const settings = await getSyncSettings();

  backendUrlInput.value = settings.backendUrl;
  autoFillRowsCheckbox.checked = settings.autoFillRows;
  autoOpenModalCheckbox.checked = settings.autoOpenModal;

  // 检查后端状态
  const backendResult = await testBackendConnection(settings.backendUrl);
  setStatus(backendStatus, backendResult.message, backendResult.success ? 'success' : 'error');

  // 检查字典状态
  await checkDictionaryStatus();
}

// 事件监听器
testBackendBtn.addEventListener('click', async () => {
  const resetLoading = showLoading(testBackendBtn, '测试中...');

  const result = await testBackendConnection(backendUrlInput.value);
  setStatus(backendStatus, result.message, result.success ? 'success' : 'error');

  resetLoading();
});

saveBackendBtn.addEventListener('click', async () => {
  const resetLoading = showLoading(saveBackendBtn, '保存中...');

  await saveBackendUrl(backendUrlInput.value);

  resetLoading();
});

updateDictBtn.addEventListener('click', async () => {
  const resetLoading = showLoading(updateDictBtn, '更新中...');

  await updateDictionary();

  resetLoading();
});

saveSettingsBtn.addEventListener('click', async () => {
  const resetLoading = showLoading(saveSettingsBtn, '保存中...');

  const settings = {
    autoFillRows: autoFillRowsCheckbox.checked,
    autoOpenModal: autoOpenModalCheckbox.checked
  };

  await setSyncSettings(settings);
  setStatus(backendStatus, '设置已保存', 'success');

  resetLoading();
});

// 启动应用
initialize();