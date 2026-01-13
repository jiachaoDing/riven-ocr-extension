// src/popup/main.ts
import type { OcrRivenResult } from '../shared/types';
import { getLastResult } from '../shared/storage';
import { testBackendConnection } from '../shared/storage';

const dropArea = document.getElementById('drop-area') as HTMLDivElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const fillButton = document.getElementById('fill-button') as HTMLButtonElement;
const resultArea = document.getElementById('result-area') as HTMLDivElement;
const settingsButton = document.getElementById('settings-button') as HTMLButtonElement;

let currentImageFile: File | null = null;
let lastOcrResult: OcrRivenResult | null = null;

function setStatus(text: string) {
  statusEl.textContent = text;
}

function enableFillButton(enabled: boolean) {
  fillButton.disabled = !enabled;
}

function displayOcrResult(result: OcrRivenResult) {
  resultArea.innerHTML = '';

  const weaponName = result.weapon_name || result.weapon_url_name || '未知武器';
  const mastery = typeof result.mastery_level === 'number' ? `段位 ${result.mastery_level}` : '';
  const polarity = result.polarity && result.polarity !== 'unknown' ? `极性 ${result.polarity}` : '';
  const modRankValue = typeof result.mod_rank === 'number' ? result.mod_rank : 0;
  const modRank = `Mod 等级 ${modRankValue}`;

  const positiveAttrs = result.attributes.filter(a => a.positive);
  const negativeAttr = result.attributes.find(a => !a.positive);

  const html = `
    <div style="margin-top: 12px; padding: 8px; background: #1f2937; border-radius: 6px; font-size: 12px;">
      <div style="font-weight: bold; margin-bottom: 6px;">识别结果：</div>
      <div>武器：${weaponName}</div>
      ${result.name ? `<div>名称：${result.name}</div>` : ''}
      ${mastery ? `<div>${mastery}</div>` : ''}
      ${polarity ? `<div>${polarity}</div>` : ''}
      ${modRank ? `<div>${modRank}</div>` : ''}
      ${positiveAttrs.length > 0 ? `<div>正面词条：${positiveAttrs.map(a => `${a.url_name} +${a.value}`).join(', ')}</div>` : ''}
      ${negativeAttr ? `<div>负面词条：${negativeAttr.url_name} ${negativeAttr.value}</div>` : ''}
      <div style="margin-top: 6px; color: #9ca3af;">置信度：${(result.confidence * 100).toFixed(1)}%</div>
    </div>
  `;

  resultArea.innerHTML = html;
}

function clearOcrResult() {
  resultArea.innerHTML = '';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // 移除 data:image/...;base64,前缀
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

function handleFiles(files: FileList | null) {
  if (!files || files.length === 0) return;
  const file = files[0];
  currentImageFile = file;
  setStatus(`已选择图片：${file.name}`);
  enableFillButton(true);
}

dropArea.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  handleFiles(fileInput.files);
});

dropArea.addEventListener('dragover', (e) => {
  e.preventDefault();
});

dropArea.addEventListener('drop', (e) => {
  e.preventDefault();
  handleFiles(e.dataTransfer?.files || null);
});

// 粘贴图片
window.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of Array.from(items)) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        currentImageFile = file;
        setStatus('已从剪贴板获取图片');
        enableFillButton(true);
      }
      break;
    }
  }
});

// OCR 按钮处理
fillButton.addEventListener('click', async () => {
  if (!currentImageFile) return;

  try {
    setStatus('正在识别图片...');
    fillButton.disabled = true;

    // 将图片转换为 base64
    const base64 = await fileToBase64(currentImageFile);

    // 发送给 service worker 进行 OCR
    const response = await chrome.runtime.sendMessage({
      type: 'PARSE_IMAGE_BASE64',
      payload: { base64 }
    });

    if (response.ok && response.data) {
      lastOcrResult = response.data;
      displayOcrResult(response.data);
      setStatus('识别成功！');
      enableWriteButton(true);
    } else {
      throw new Error(response.error || '识别失败');
    }
  } catch (error) {
    console.error('OCR failed:', error);
    let message = '未知错误';

    if (error instanceof Error) {
      // 提供更友好的错误信息
      if (error.message.includes('HTTP')) {
        message = '后端服务响应错误，请检查服务状态或配置';
      } else if (error.message.includes('fetch')) {
        message = '网络连接失败，请检查后端地址配置';
      } else if (error.message.includes('JSON')) {
        message = '响应格式错误，请检查后端服务';
      } else {
        message = error.message;
      }
    }

    setStatus(`识别失败：${message}`);
    clearOcrResult();
    enableWriteButton(false);
  } finally {
    fillButton.disabled = false;
  }
});

// 创建写入按钮
const writeButton = document.createElement('button');
writeButton.textContent = '写入当前 warframe.market 页面';
writeButton.disabled = true;
writeButton.style.marginTop = '8px';
fillButton.insertAdjacentElement('afterend', writeButton);

function enableWriteButton(enabled: boolean) {
  writeButton.disabled = !enabled;
}

// 写入按钮处理
writeButton.addEventListener('click', async () => {
  if (!lastOcrResult) return;

  try {
    setStatus('正在写入页面...');
    writeButton.disabled = true;

    // 获取当前活动标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.id) {
      throw new Error('无法获取当前页面');
    }

    // 检查是否是 warframe.market 页面
    if (!tab.url?.includes('warframe.market')) {
      throw new Error('请在 warframe.market 页面使用此功能');
    }

    // 发送消息给 content script
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'FILL_AUCTION_FORM',
      payload: lastOcrResult
    });

    if (response.ok) {
      setStatus('写入成功！请检查页面表单是否已填写。');
    } else {
      throw new Error(response.error || '写入失败');
    }
  } catch (error) {
    console.error('Fill form failed:', error);
    let message = '未知错误';

    if (error instanceof Error) {
      if (error.message.includes('未找到')) {
        message = '未找到拍卖表单，请确保已打开warframe.market的拍卖页面';
      } else if (error.message.includes('weapon')) {
        message = '武器选择失败，请手动选择武器';
      } else if (error.message.includes('attribute')) {
        message = '词条填写失败，请手动填写词条';
      } else {
        message = error.message;
      }
    }

    setStatus(`写入失败：${message}`);
  } finally {
    writeButton.disabled = false;
  }
});

// 初始化应用
async function initialize() {
  try {
    // 检查后端连接状态
    const backendUrl = await chrome.runtime.sendMessage({ type: 'GET_BACKEND_URL' });
    if (backendUrl) {
      const result = await testBackendConnection(backendUrl);
      if (!result.success) {
        setStatus(`后端连接异常：${result.message}`);
        return;
      }
    }

    // 尝试加载上次的结果
    const lastResult = await getLastResult();
    if (lastResult) {
      lastOcrResult = lastResult;
      displayOcrResult(lastResult);
      setStatus('已加载上次识别结果');
      enableWriteButton(true);
    } else {
      setStatus('准备就绪，请上传紫卡截图');
    }
  } catch (error) {
    console.error('Initialization error:', error);
    setStatus('初始化失败，请检查扩展设置');
  }
}

// 设置按钮处理
settingsButton.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// 启动应用
initialize();
