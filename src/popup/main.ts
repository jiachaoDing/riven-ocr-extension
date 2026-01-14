// src/popup/main.ts
import type { OcrRivenResult, MarketPriceResult } from '../shared/types';
import { getLastResult, testBackendConnection, getSyncSettings, setSyncSettings } from '../shared/storage';
import { loadDictionary, getAttributeEntry } from '../shared/dictionary';

// --- DOM Elements ---
const mainView = document.getElementById('main-view') as HTMLDivElement;
const settingsView = document.getElementById('settings-view') as HTMLDivElement;
const viewToggleBtn = document.getElementById('view-toggle') as HTMLButtonElement;
const settingsIcon = document.getElementById('settings-icon') as unknown as SVGElement;
const backIcon = document.getElementById('back-icon') as unknown as SVGElement;
const themeToggleBtn = document.getElementById('theme-toggle') as HTMLButtonElement;

// Main View Elements
const dropArea = document.getElementById('drop-area') as HTMLDivElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const fillButton = document.getElementById('fill-button') as HTMLButtonElement;
const resultArea = document.getElementById('result-area') as HTMLDivElement;
const previewContainer = document.getElementById('preview-container') as HTMLDivElement;
const imagePreview = document.getElementById('image-preview') as HTMLImageElement;
const removePreviewBtn = document.getElementById('remove-preview') as HTMLButtonElement;

// Settings View Elements
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
const saveSettingsBtn = document.getElementById('save-settings') as HTMLButtonElement;

// --- State ---
let currentImageFile: File | null = null;
let lastOcrResult: OcrRivenResult | null = null;
let currentView: 'main' | 'settings' = 'main';

// --- View Logic ---
function switchView(view: 'main' | 'settings') {
  currentView = view;
  if (view === 'main') {
    mainView.classList.add('active');
    settingsView.classList.remove('active');
    settingsIcon.style.display = 'block';
    backIcon.style.display = 'none';
  } else {
    mainView.classList.remove('active');
    settingsView.classList.add('active');
    settingsIcon.style.display = 'none';
    backIcon.style.display = 'block';
    refreshSettingsView();
  }
}

viewToggleBtn.addEventListener('click', () => {
  switchView(currentView === 'main' ? 'settings' : 'main');
});

// --- Theme Logic ---
async function applyTheme(theme: 'light' | 'dark' | 'system') {
  let effectiveTheme = theme;
  if (theme === 'system') {
    effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', effectiveTheme);
}

themeToggleBtn.addEventListener('click', async () => {
  const settings = await getSyncSettings();
  const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  await setSyncSettings({ theme: newTheme });
  applyTheme(newTheme);
});

// --- Main OCR Logic ---
function setStatus(text: string, type: 'info' | 'success' | 'error' = 'info') {
  statusEl.textContent = text;
  // 可以根据 type 改变样式，这里先简单实现
}

function enableFillButton(enabled: boolean) {
  fillButton.disabled = !enabled;
}

async function fetchMarketPrice(weaponUrlName: string): Promise<MarketPriceResult | null> {
  try {
    const settings = await getSyncSettings();
    if (!settings.marketPriceUrl) return null;
    
    const url = `${settings.marketPriceUrl}/api/RivenTracker/yesterday-price?weapon=${weaponUrlName}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error('Fetch market price failed:', error);
    return null;
  }
}

async function displayOcrResult(result: OcrRivenResult) {
  resultArea.innerHTML = '';

  // 加载字典
  const dict = await loadDictionary();

  const weaponName = result.weapon_name || result.weapon_url_name;
  const seenAttrs = new Set<string>();
  const positiveAttrs = result.attributes.filter(a => {
    if (a.positive && !seenAttrs.has(a.url_name)) {
      seenAttrs.add(a.url_name);
      return true;
    }
    return false;
  });
  const negativeAttr = result.attributes.find(a => !a.positive);

  // 获取属性显示名称
  const getAttributeDisplayName = (urlName: string) => {
    const entry = getAttributeEntry(urlName, dict);
    return entry ? entry.names.zh[0] || urlName : urlName;
  };
  // 检查是否有缺失字段
  const isWeaponMissing = !weaponName;
  const isNameMissing = !result.name;
  const isMasteryMissing = typeof result.mastery_level !== 'number';
  const isPolarityMissing = !result.polarity || result.polarity === 'unknown';
  const isRankMissing = typeof result.mod_rank !== 'number';
  const isRerollsMissing = typeof result.re_rolls !== 'number';

  const hasAnyMissing = isWeaponMissing || isNameMissing || isMasteryMissing || isPolarityMissing || isRankMissing || isRerollsMissing;

  const renderField = (label: string, value: any, isMissing: boolean) => {
    const displayValue = isMissing 
      ? '<span style="color: #9ca3af; font-size: 11px; border: 1px dashed var(--border); padding: 0 4px; border-radius: 4px; font-style: italic;">待补全</span>' 
      : `<span style="font-weight: 500;">${value}</span>`;
    return `<div><span style="color: var(--text-secondary)">${label}：</span>${displayValue}</div>`;
  };

  // 异步获取价格信息
  let priceHtml = '<div id="price-loading" style="font-size: 12px; color: var(--text-secondary); margin-top: 8px;">正在查询市场参考价...</div>';
  
  const card = document.createElement('div');
  card.className = 'result-card';
  card.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; border-bottom: 1px solid var(--border); padding-bottom: 4px;">
      <span style="font-weight: 700;">识别结果</span>
      ${hasAnyMissing ? '<span style="font-size: 10px; color: var(--text-secondary); background: var(--bg-main); border: 1px solid var(--border); padding: 1px 6px; border-radius: 4px;">数据不全</span>' : ''}
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 13px;">
      ${renderField('武器', weaponName, isWeaponMissing)}
      ${renderField('名称', result.name, isNameMissing)}
      ${renderField('段位', result.mastery_level, isMasteryMissing)}
      ${renderField('极性', result.polarity, isPolarityMissing)}
      ${renderField('等级', result.mod_rank, isRankMissing)}
      ${renderField('洗炼', result.re_rolls, isRerollsMissing)}
    </div>
    <div style="margin-top: 10px; font-size: 13px;">
      <div style="color: var(--text-secondary); margin-bottom: 4px;">属性：</div>
      ${positiveAttrs.length > 0
        ? positiveAttrs.map(a => `<div style="color: #10b981;">+ ${getAttributeDisplayName(a.url_name)} ${a.value}</div>`).join('')
        : '<div style="color: #9ca3af; font-size: 11px; font-style: italic;">[ 正面属性未识别 ]</div>'}
      ${negativeAttr ? `<div style="color: #ef4444;">- ${getAttributeDisplayName(negativeAttr.url_name)} ${negativeAttr.value}</div>` : ''}
    </div>
    <div id="market-price-container">${priceHtml}</div>
    <div style="margin-top: 12px; font-size: 11px; color: var(--text-secondary); display: flex; justify-content: space-between; align-items: center;">
      <span>置信度: ${(result.confidence * 100).toFixed(1)}%</span>
      <button id="write-button" class="btn-primary" style="width: auto; padding: 4px 12px; font-size: 12px;">写入页面</button>
    </div>
    ${hasAnyMissing ? `<div style="margin-top: 8px; font-size: 10px; color: #9ca3af; font-style: italic;">提示：虚线框项未能自动识别，写入后请在网页上手动补全。</div>` : ''}
  `;

  resultArea.appendChild(card);
  
  const writeBtn = card.querySelector('#write-button') as HTMLButtonElement;
  writeBtn.addEventListener('click', handleWriteToPage);

  // 填充价格信息
  if (result.weapon_url_name) {
    const priceData = await fetchMarketPrice(result.weapon_url_name);
    const container = card.querySelector('#market-price-container');
    if (container) {
      if (priceData && priceData.success) {
        container.innerHTML = `
          <a href="https://lab.webutilitykit.com/apps/RivenTracker/?weapon=${result.weapon_url_name}" target="_blank" style="text-decoration: none; color: inherit; display: block; margin-top: 10px;">
            <div class="price-card" style="padding: 10px; background: var(--bg-main); border-radius: 8px; border: 1px solid var(--border); cursor: pointer; transition: all 0.2s ease;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <span style="font-size: 11px; color: var(--text-secondary);">市场行情 (昨日底价均价)</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary); opacity: 0.5;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: baseline;">
                <span style="font-size: 20px; font-weight: 800; color: #f59e0b;">${priceData.avg_bottom_price} <span style="font-size: 12px; font-weight: 400;">白金</span></span>
                <span style="font-size: 11px; color: var(--text-secondary);">在售数量: ${priceData.active_count}</span>
              </div>
              <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--border); font-size: 9px; color: var(--text-secondary); text-align: right; opacity: 0.6;">
                数据来源: Riven Tracker
              </div>
            </div>
          </a>
          <style>
            .price-card:hover {
              border-color: #f59e0b;
              transform: translateY(-1px);
              box-shadow: var(--shadow);
            }
          </style>
        `;
      } else {
        container.innerHTML = ''; // 或者显示查询失败
      }
    }
  } else {
    const container = card.querySelector('#market-price-container');
    if (container) container.innerHTML = '';
  }
}

// 写入按钮处理逻辑 (从原 writeButton 事件搬迁并微调)
async function handleWriteToPage() {
  if (!lastOcrResult) return;
  const btn = document.getElementById('write-button') as HTMLButtonElement;
  try {
    setStatus('正在写入页面...', 'info');
    if (btn) btn.disabled = true;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id || !tab.url?.includes('warframe.market')) {
      throw new Error('请在 warframe.market 页面使用此功能');
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'FILL_AUCTION_FORM',
      payload: lastOcrResult
    });

    if (response.ok) {
      setStatus('写入成功！', 'success');
    } else {
      throw new Error(response.error || '写入失败');
    }
  } catch (error: any) {
    setStatus(`写入失败：${error.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function handleFiles(files: FileList | null) {
  if (!files || files.length === 0) return;
  const file = files[0];
  if (!file.type.startsWith('image/')) {
    setStatus('请选择图片文件', 'error');
    return;
  }
  currentImageFile = file;
  setStatus(`已选择：${file.name}`);
  enableFillButton(true);
  showPreview(file);
}

function showPreview(file: File) {
  const reader = new FileReader();
  reader.onload = (e) => {
    imagePreview.src = e.target?.result as string;
    previewContainer.style.display = 'block';
    dropArea.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

function removePreview() {
  currentImageFile = null;
  imagePreview.src = '';
  previewContainer.style.display = 'none';
  dropArea.style.display = 'block';
  enableFillButton(false);
  setStatus('准备就绪，请上传紫卡截图');
}

removePreviewBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  removePreview();
});

dropArea.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => handleFiles(fileInput.files));
dropArea.addEventListener('dragover', (e) => e.preventDefault());
dropArea.addEventListener('drop', (e) => {
  e.preventDefault();
  handleFiles(e.dataTransfer?.files || null);
});

window.addEventListener('paste', (e) => {
  const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
  if (item) {
    const file = item.getAsFile();
    if (file) {
      currentImageFile = file;
      setStatus('已从剪贴板获取图片');
      enableFillButton(true);
      showPreview(file);
    }
  }
});

fillButton.addEventListener('click', async () => {
  if (!currentImageFile) return;
  try {
    setStatus('正在识别图片...');
    fillButton.disabled = true;

    const reader = new FileReader();
    const base64Promise = new Promise<string>((resolve) => {
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.readAsDataURL(currentImageFile!);
    });
    
    const base64 = await base64Promise;
    const response = await chrome.runtime.sendMessage({
      type: 'PARSE_IMAGE_BASE64',
      payload: { base64 }
    });

    if (response.ok && response.data) {
      lastOcrResult = response.data;
      displayOcrResult(response.data);
      setStatus('识别成功！', 'success');
    } else {
      throw new Error(response.error || '识别失败');
    }
  } catch (error: any) {
    setStatus(`识别失败：${error.message}`, 'error');
  } finally {
    fillButton.disabled = false;
  }
});

// --- Settings Logic ---
async function refreshSettingsView() {
  const settings = await getSyncSettings();
  backendUrlInput.value = settings.backendUrl;
  marketPriceUrlInput.value = settings.marketPriceUrl || '';
  autoFillRowsCheckbox.checked = settings.autoFillRows;
  autoOpenModalCheckbox.checked = settings.autoOpenModal;

  // Check Backend
  setLoadingBadge(backendStatus, '测试中...');
  const result = await testBackendConnection(settings.backendUrl);
  setBadge(backendStatus, result.message, result.success ? 'success' : 'error');

  // Check Dictionary
  try {
    const dict = await loadDictionary();
    dictVersion.textContent = `${Object.keys(dict.weapon_dict).length} 武器 / ${Object.keys(dict.attribute_dict).length} 属性`;
    setBadge(dictStatus, '加载成功', 'success');
  } catch (e) {
    setBadge(dictStatus, '加载失败', 'error');
  }
}

function setBadge(el: HTMLElement, text: string, type: 'success' | 'error' | 'info') {
  el.textContent = text;
  el.className = `status-badge ${type}`;
}

function setLoadingBadge(el: HTMLElement, text: string) {
  el.textContent = text;
  el.className = `status-badge info`;
}

testBackendBtn.addEventListener('click', async () => {
  setLoadingBadge(backendStatus, '正在测试...');
  const result = await testBackendConnection(backendUrlInput.value);
  setBadge(backendStatus, result.message, result.success ? 'success' : 'error');
});

saveBackendBtn.addEventListener('click', async () => {
  await setSyncSettings({ backendUrl: backendUrlInput.value });
  setBadge(backendStatus, '已保存', 'success');
});

updateDictBtn.addEventListener('click', async () => {
  setBadge(dictStatus, '正在更新...', 'info');
  await chrome.storage.local.remove(['dictionary']);
  await refreshSettingsView();
});

saveSettingsBtn.addEventListener('click', async () => {
  await setSyncSettings({
    backendUrl: backendUrlInput.value,
    marketPriceUrl: marketPriceUrlInput.value,
    autoFillRows: autoFillRowsCheckbox.checked,
    autoOpenModal: autoOpenModalCheckbox.checked
  });
  setStatus('设置已保存', 'success');
  switchView('main');
});

// --- Initialize ---
async function initialize() {
  const settings = await getSyncSettings();
  applyTheme(settings.theme);

  try {
    const lastResult = await getLastResult();
    if (lastResult) {
      lastOcrResult = lastResult;
      displayOcrResult(lastResult);
      setStatus('已加载上次识别结果');
    }
  } catch (e) {
    console.error('Failed to load last result', e);
  }
}

initialize();
