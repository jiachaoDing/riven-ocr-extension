// src/popup/main.ts
const dropArea = document.getElementById('drop-area') as HTMLDivElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const fillButton = document.getElementById('fill-button') as HTMLButtonElement;

let currentImageFile: File | null = null;

function setStatus(text: string) {
  statusEl.textContent = text;
}

function enableFillButton(enabled: boolean) {
  fillButton.disabled = !enabled;
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

fillButton.addEventListener('click', async () => {
  if (!currentImageFile) return;
  setStatus('这里未来会调用后端 OCR，然后写入当前页面…');
  // TODO: 下一步在这里通过 chrome.runtime.sendMessage 把图片发给 service worker
});
