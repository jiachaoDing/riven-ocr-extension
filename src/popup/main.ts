// src/popup/main.ts
import type { OcrRivenResult, MarketPriceResult } from '../shared/types';
import { getLastResult, getSyncSettings, setSyncSettings } from '../shared/storage';
import { loadDictionary, getAttributeEntry } from '../shared/dictionary';
import { SettingsManager } from './settings';

// --- Initialize Settings ---
const settingsManager = new SettingsManager();

// --- DOM Elements ---
const viewToggleBtn = document.getElementById('view-toggle') as HTMLButtonElement;
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

// --- State ---
let currentImageFile: File | null = null;
let lastOcrResult: OcrRivenResult | null = null;

// --- View Logic ---
viewToggleBtn.addEventListener('click', () => {
  settingsManager.toggleView();
});

// Listen for settings saved event
document.addEventListener('settings-saved', (e: any) => {
  setStatus(e.detail.message, 'success');
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
  statusEl.className = `status-badge ${type} text-center block w-full`;
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
    return entry ? entry.names.en[0] || urlName : urlName;
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
      ? '<span class="text-[10px] text-on-surface-variant/40 italic border border-dashed border-outline/20 px-1.5 rounded">Required</span>' 
      : `<span class="font-bold text-on-surface">${value}</span>`;
    return `<div class="flex flex-col"><span class="text-[10px] uppercase tracking-wider text-on-surface-variant opacity-60 font-bold">${label}</span>${displayValue}</div>`;
  };

  // 异步获取价格信息
  let priceHtml = '<div id="price-loading" class="text-[11px] text-on-surface-variant/60 animate-pulse mt-4 flex items-center gap-2"><div class="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>Fetching market prices...</div>';
  
  const card = document.createElement('div');
  card.className = 'm3-card relative overflow-hidden';
  card.innerHTML = `
    <div class="flex justify-between items-center mb-4 border-b border-outline/10 pb-2">
      <div class="flex items-center gap-2">
        <div class="w-2 h-4 bg-primary rounded-full"></div>
        <span class="font-bold text-sm tracking-tight text-on-surface">OCR Result</span>
      </div>
      ${hasAnyMissing ? '<span class="text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 rounded-full uppercase tracking-wider">Incomplete</span>' : ''}
    </div>
    
    <div class="grid grid-cols-3 gap-y-4 gap-x-2 text-xs">
      ${renderField('Weapon', weaponName, isWeaponMissing)}
      ${renderField('Name', result.name, isNameMissing)}
      ${renderField('MR', result.mastery_level, isMasteryMissing)}
      ${renderField('Polarity', result.polarity, isPolarityMissing)}
      ${renderField('Rank', result.mod_rank, isRankMissing)}
      ${renderField('Rerolls', result.re_rolls, isRerollsMissing)}
    </div>

    <div class="mt-5 space-y-2">
      <div class="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant opacity-60">Attributes</div>
      <div class="bg-surface-variant/20 dark:bg-surface-variant/10 rounded-lg p-2.5 space-y-1.5 border border-outline/5">
        ${positiveAttrs.length > 0
          ? positiveAttrs.map(a => `
            <div class="flex items-center gap-2 text-[13px] font-medium text-emerald-600 dark:text-emerald-400">
              <span class="w-12 shrink-0 font-bold tabular-nums">${a.value}</span>
              <span class="opacity-90">${getAttributeDisplayName(a.url_name)}</span>
            </div>`).join('')
          : '<div class="text-[11px] text-on-surface-variant/40 italic py-1">No positive attributes detected</div>'}
        
        ${negativeAttr ? `
          <div class="h-px bg-outline/5 my-1"></div>
          <div class="flex items-center gap-2 text-[13px] font-medium text-rose-600 dark:text-rose-400">
            <span class="w-12 shrink-0 font-bold tabular-nums">${negativeAttr.value}</span>
            <span class="opacity-90">${getAttributeDisplayName(negativeAttr.url_name)}</span>
          </div>` : ''}
      </div>
    </div>

    <div id="market-price-container">${priceHtml}</div>

    <div class="mt-6 flex items-center justify-between border-t border-outline/10 pt-4">
      <div class="flex items-center gap-1.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        Please double-check submitting..
      </div>
      <button id="write-button" class="m3-btn-tonal !bg-primary !text-on-primary shadow-sm hover:shadow-md">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Fill Page
      </button>
    </div>
    
    ${hasAnyMissing ? `<div class="mt-3 text-[9px] text-on-surface-variant/50 italic leading-tight text-center">Items in dashed boxes need manual correction on the page.</div>` : ''}
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
          <a href="https://lab.webutilitykit.com/apps/RivenTracker/en/?weapon=${result.weapon_url_name}" target="_blank" class="block mt-4 group no-underline">
            <div class="bg-amber-50 dark:bg-amber-400/10 border border-amber-200 dark:border-amber-400/20 rounded-xl p-3 transition-all hover:scale-[1.02] hover:shadow-md active:scale-95">
              <div class="flex justify-between items-center mb-1">
                <span class="text-[10px] font-bold uppercase tracking-wider text-amber-700/70 dark:text-amber-300/80">Unrolled Market Trend</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="text-amber-500 opacity-50"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              </div>
              <div class="flex justify-between items-end">
                <div class="flex items-baseline gap-1">
                  <span class="text-2xl font-black text-amber-600 dark:text-amber-300 tabular-nums">${priceData.avg_bottom_price}</span>
                  <span class="text-[10px] font-bold text-amber-600/60 dark:text-amber-300/60 uppercase">P</span>
                </div>
                <div class="text-[10px] text-on-surface-variant opacity-60 font-medium">
                   ${priceData.active_count} In-game
                </div>
              </div>
              <div class="mt-2 text-[8px] text-on-surface-variant opacity-40 text-right uppercase tracking-widest font-bold">
                Source: Riven Tracker
              </div>
            </div>
          </a>
        `;
      } else {
        container.innerHTML = '';
      }
    }
  } else {
    const container = card.querySelector('#market-price-container');
    if (container) container.innerHTML = '';
  }
}

async function handleWriteToPage() {
  if (!lastOcrResult) return;
  const btn = document.getElementById('write-button') as HTMLButtonElement;
  try {
    setStatus('Filling page...', 'info');
    if (btn) btn.disabled = true;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id || !tab.url?.includes('warframe.market')) {
      throw new Error('Please use this on warframe.market');
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'FILL_AUCTION_FORM',
      payload: lastOcrResult
    });

    if (response.ok) {
      setStatus('Successfully filled!', 'success');
    } else {
      throw new Error(response.error || 'Failed to fill');
    }
  } catch (error: any) {
    setStatus(`Failed: ${error.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function handleFiles(files: FileList | null) {
  if (!files || files.length === 0) return;
  const file = files[0];
  if (!file.type.startsWith('image/')) {
    setStatus('Please select an image file', 'error');
    return;
  }
  currentImageFile = file;
  setStatus(`Selected: ${file.name}`);
  enableFillButton(true);
  showPreview(file);
}

function showPreview(file: File) {
  const reader = new FileReader();
  reader.onload = (e) => {
    imagePreview.src = e.target?.result as string;
    // 使用 flex 确保预览图居中，同时移除 hidden
    previewContainer.classList.remove('hidden');
    previewContainer.classList.add('flex');
    dropArea.classList.add('hidden');
  };
  reader.readAsDataURL(file);
}

function removePreview() {
  currentImageFile = null;
  imagePreview.src = '';
  previewContainer.classList.add('hidden');
  previewContainer.classList.remove('flex');
  dropArea.classList.remove('hidden');
  enableFillButton(false);
  setStatus('Ready, please upload Riven screenshot');
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
      setStatus('Image obtained from clipboard');
      enableFillButton(true);
      showPreview(file);
    }
  }
});

fillButton.addEventListener('click', async () => {
  if (!currentImageFile) return;
  try {
    setStatus('Recognizing image...');
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
      setStatus('Recognition successful!', 'success');
    } else {
      throw new Error(response.error || 'Recognition failed');
    }
  } catch (error: any) {
    setStatus(`Failed: ${error.message}`, 'error');
  } finally {
    fillButton.disabled = false;
  }
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
      setStatus('Loaded last recognition result');
    }
  } catch (e) {
    console.error('Failed to load last result', e);
  }
}

initialize();
