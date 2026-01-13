// src/content/content-script.ts
// 内联共享类型和函数，避免模块导入问题
type Lang = 'en' | 'zh';

interface DictEntry {
  url_name: string;
  names: {
    en: string[];
    zh: string[];
  };
}

interface RivenDictionary {
  weapon_dict: Record<string, DictEntry>;
  attribute_dict: Record<string, DictEntry>;
}

interface OcrRivenResult {
  weapon_url_name?: string;
  weapon_name?: string;
  name?: string;
  re_rolls?: number;
  mastery_level?: number;
  polarity?: 'madurai' | 'naramon' | 'vazarin' | 'unknown';
  mod_rank?: number;
  attributes: OcrAttribute[];
  type: 'riven';
  confidence: number;
}

interface OcrAttribute {
  url_name: string;
  value: number;
  positive: boolean;
}

// 内联字典相关函数
function detectLangFromUrl(url: string): Lang {
  return url.includes('/zh-hans/') ? 'zh' : 'en';
}

async function loadDictionary(): Promise<RivenDictionary> {
  // 通过 background script 获取字典，避免 content script 中 fetch 失败的问题
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_DICTIONARY' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response && response.ok) {
        resolve(response.data);
      } else {
        reject(new Error(response?.error || '获取字典失败'));
      }
    });
  });
}

function getWeaponEntry(
  ocrWeaponUrlName: string | undefined,
  ocrWeaponName: string | undefined,
  dict: RivenDictionary
): DictEntry | null {
  if (ocrWeaponUrlName && dict.weapon_dict[ocrWeaponUrlName]) {
    return dict.weapon_dict[ocrWeaponUrlName];
  }
  if (!ocrWeaponName) return null;

  const target = normalize(ocrWeaponName);
  let best: { entry: DictEntry | null; score: number } = { entry: null, score: 0 };

  for (const entry of Object.values(dict.weapon_dict)) {
    for (const name of [...entry.names.en, ...entry.names.zh]) {
      const n = normalize(name);
      if (n === target) return entry;
      if (n.includes(target) || target.includes(n)) {
        const score = Math.min(n.length, target.length);
        if (score > best.score) {
          best = { entry, score };
        }
      }
    }
  }
  return best.entry;
}

function getAttributeEntry(urlName: string, dict: RivenDictionary): DictEntry | null {
  return dict.attribute_dict[urlName] || null;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+|·|\./g, '');
}

console.log('[Riven OCR] content script loaded on', location.href);

interface FillResponse {
  ok: boolean;
  error?: string;
}

// DOM 操作工具函数
function waitForElement(selector: string, timeout = 5000): Promise<Element> {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }

    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element ${selector} not found within ${timeout}ms`));
    }, timeout);
  });
}

function triggerInputEvent(element: HTMLInputElement | HTMLSelectElement) {
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function triggerKeyupEvent(element: HTMLInputElement) {
  element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
}

async function simulateTyping(input: HTMLInputElement, text: string) {
  input.focus();
  input.value = text;
  triggerInputEvent(input);
  triggerKeyupEvent(input);
  // 等待下拉列表渲染
  await new Promise(resolve => setTimeout(resolve, 100));
}

async function selectFromDropdown(root: Element, input: HTMLInputElement, searchText: string, selector = 'li.selectable span') {
  await simulateTyping(input, searchText);

  // 等待下拉菜单出现
  await new Promise(resolve => setTimeout(resolve, 200));

  // 在整个文档中查找下拉项，因为下拉菜单可能不在 root 元素内
  const dropdownItems = document.querySelectorAll(selector);
  console.log('[Riven OCR] Found dropdown items:', dropdownItems.length);

  for (const item of Array.from(dropdownItems)) {
    const text = item.textContent?.trim();
    console.log('[Riven OCR] Checking dropdown item:', text);
    if (text && (text.toLowerCase().includes(searchText.toLowerCase()) || searchText.toLowerCase().includes(text.toLowerCase()))) {
      console.log('[Riven OCR] Clicking dropdown item:', text);
      (item as HTMLElement).click();
      // 等待选择完成
      await new Promise(resolve => setTimeout(resolve, 100));
      return true;
    }
  }
  return false;
}

// 业务逻辑函数
function buildWeaponSearchText(ocr: OcrRivenResult, dict: any, lang: Lang): string | null {
  console.log('[Riven OCR] Building weapon search text for:', {
    weapon_url_name: ocr.weapon_url_name,
    weapon_name: ocr.weapon_name,
    lang
  });

  const entry = getWeaponEntry(ocr.weapon_url_name, ocr.weapon_name, dict);
  if (!entry) {
    console.warn('[Riven OCR] Weapon entry not found in dictionary');
    return null;
  }

  const searchText = entry.names[lang][0] || null;
  console.log('[Riven OCR] Weapon search text result:', searchText);
  return searchText;
}

function buildAttributeSearchText(urlName: string, dict: any, lang: Lang): string | null {
  const entry = getAttributeEntry(urlName, dict);
  if (!entry) return urlName; // fallback to url_name
  return entry.names[lang][0] || urlName;
}

async function clearExistingAttributes(root: Document | HTMLElement): Promise<void> {
  console.log('[Riven OCR] Clearing existing attributes...');
  // 查找已选择词条的删除按钮
  const removeButtons = Array.from(root.querySelectorAll('.attribute-seeker__selected .selected-unit .btn')) as HTMLButtonElement[];
  
  if (removeButtons.length > 0) {
    console.log(`[Riven OCR] Found ${removeButtons.length} attributes to clear`);
    for (const btn of removeButtons) {
      btn.click();
      // 每次点击后稍微等待，让网页更新 DOM
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

// DOM 填充函数
async function openAuctionModalIfNeeded(root: Document | HTMLElement): Promise<void> {
  console.log('[Riven OCR] Checking if auction modal needs to be opened...');

  const modal = document.querySelector('.modal--Csf66');
  const createButton = document.querySelector('.auction-create__button-circle') as HTMLButtonElement;

  // 如果有按钮，优先点击按钮，这是最稳妥的打开方式
  if (createButton) {
    console.log('[Riven OCR] Found create auction button, clicking it...');
    createButton.click();
    // 给一点时间让系统处理点击事件并添加 class
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  // 无论有没有点击按钮，都确保 class 被正确添加（双重保险）
  const targetModal = modal || document.querySelector('.modal--Csf66');
  if (targetModal) {
    console.log('[Riven OCR] Ensuring "opened--LfN_k" class is applied to modal...');
    if (!targetModal.classList.contains('opened--LfN_k')) {
      targetModal.classList.add('opened--LfN_k');
    }
    
    // 等待过渡动画
    await new Promise(resolve => setTimeout(resolve, 400));
    
    // 再次确认是否真的可见了
    if (targetModal.classList.contains('opened--LfN_k')) {
      console.log('[Riven OCR] Auction modal should now be visible');
      return;
    }
  }

  if (!createButton && !targetModal) {
    console.error('[Riven OCR] Both create button and modal element not found');
    throw new Error('未找到拍卖模态框，请确保已登录并处于正确的页面');
  }
}

async function fillCategory(root: Document | HTMLElement): Promise<void> {
  console.log('[Riven OCR] Filling category...');
  const categorySelect = root.querySelector('#auction-create__auctionCategory') as HTMLSelectElement;
  if (categorySelect) {
    categorySelect.value = 'riven'; // 设置为裂罅 Mod
    triggerInputEvent(categorySelect);
    console.log('[Riven OCR] Category set to riven');
  } else {
    console.warn('[Riven OCR] Category select not found');
  }
}

async function fillWeapon(root: Document | HTMLElement, weaponSearchText: string): Promise<void> {
  console.log('[Riven OCR] Filling weapon with search text:', weaponSearchText);

  // 查找武器选择器 - 使用文档中描述的结构
  const itemSeeker = root.querySelector('.item-seeker') as HTMLElement;
  if (!itemSeeker) {
    console.warn('[Riven OCR] Item seeker container not found');
    return;
  }

  // 查找输入框
  const input = itemSeeker.querySelector('.item-seeker__input .real-input input') as HTMLInputElement;
  console.log('[Riven OCR] Weapon input found:', !!input);

  if (input && weaponSearchText) {
    // 点击action按钮打开dropdown
    const actionButton = itemSeeker.querySelector('.item-seeker__action') as HTMLButtonElement;
    if (actionButton) {
      actionButton.click();
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('[Riven OCR] Selecting from dropdown...');
    const found = await selectFromDropdown(itemSeeker, input, weaponSearchText, 'li.selectable span');
    if (!found) {
      console.warn('[Riven OCR] Weapon not found in dropdown:', weaponSearchText);
    } else {
      console.log('[Riven OCR] Weapon selection successful');
    }
  } else {
    console.warn('[Riven OCR] Weapon input or search text missing');
  }
}

async function fillPositiveAttributes(root: Document | HTMLElement, attrs: any[], dict: any, lang: Lang): Promise<void> {
  console.log('[Riven OCR] Filling positive attributes, count:', attrs.length);

  // 获取现有的正面词条输入行 - 使用文档中描述的结构
  let positiveContainers = root.querySelectorAll('.attribute-seeker.minimalistic:not(.negative)');

  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    let container = positiveContainers[i] as HTMLElement;

    // 如果不够行数，尝试点击添加按钮
    if (!container) {
      // 修复选择器：querySelector 不支持 :contains
      const buttons = Array.from(root.querySelectorAll('button.btn__light--c9XBJ, button.btn'));
      const addButton = buttons.find(btn => 
        btn.textContent?.includes('+ 增加') || 
        btn.textContent?.includes('+ Add')
      ) as HTMLButtonElement;

      if (addButton) {
        console.log('[Riven OCR] Clicking add button for positive attribute', i);
        addButton.click();
        await new Promise(resolve => setTimeout(resolve, 200));
        positiveContainers = root.querySelectorAll('.attribute-seeker.minimalistic:not(.negative)');
        container = positiveContainers[i] as HTMLElement;
      }
    }

    if (!container) {
      console.warn('[Riven OCR] Cannot find container for positive attribute', i);
      continue;
    }

    console.log('[Riven OCR] Filling positive attribute', i, attr.url_name);

    // 点击action按钮打开dropdown
    const actionButton = container.querySelector('.attribute-seeker__action') as HTMLButtonElement;
    if (actionButton) {
      actionButton.click();
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // 填充属性
    const dropdownInputs = container.querySelector('.attribute-seeker__dropdown .dropdown__inputs .real-input input') as HTMLInputElement;
    const valueInput = root.querySelector(`#auction-create__value_${i}`) as HTMLInputElement;

    if (dropdownInputs) {
      const searchText = buildAttributeSearchText(attr.url_name, dict, lang);
      if (searchText) {
        await selectFromDropdown(container, dropdownInputs, searchText, 'li.selectable span');
      }
    }

    if (valueInput) {
      valueInput.value = Math.abs(attr.value).toString();
      triggerInputEvent(valueInput);
    }
  }
}

async function fillNegativeAttribute(root: Document | HTMLElement, attr: any, dict: any, lang: Lang): Promise<void> {
  console.log('[Riven OCR] Filling negative attribute:', attr.url_name);

  const negativeContainer = root.querySelector('.attribute-seeker.minimalistic.negative') as HTMLElement;
  if (!negativeContainer) {
    console.warn('[Riven OCR] Negative attribute container not found');
    return;
  }

  console.log('[Riven OCR] Negative container found');

  // 点击action按钮打开dropdown
  const actionButton = negativeContainer.querySelector('.attribute-seeker__action') as HTMLButtonElement;
  if (actionButton) {
    actionButton.click();
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // 填充属性
  const dropdownInputs = negativeContainer.querySelector('.attribute-seeker__dropdown .dropdown__inputs .real-input input') as HTMLInputElement;
  const valueInput = root.querySelector('#auction-create__value_negative') as HTMLInputElement;

  if (dropdownInputs) {
    const searchText = buildAttributeSearchText(attr.url_name, dict, lang);
    if (searchText) {
      await selectFromDropdown(negativeContainer, dropdownInputs, searchText, 'li.selectable span');
    }
  }

  if (valueInput) {
    valueInput.value = Math.abs(attr.value).toString();
    triggerInputEvent(valueInput);
  }
}

async function fillRivenModName(root: Document | HTMLElement, modName: string): Promise<void> {
  console.log('[Riven OCR] Filling riven mod name:', modName);

  const modNameSelect = root.querySelector('#auctions-create__modName') as HTMLSelectElement;
  if (!modNameSelect) {
    console.warn('[Riven OCR] Mod name select not found');
    return;
  }

  // 增加重试逻辑，等待选项加载（通常在属性选择后才会由网页后端生成并更新 DOM）
  let options: HTMLOptionElement[] = [];
  for (let i = 0; i < 10; i++) { // 最多等待 2 秒
    options = Array.from(modNameSelect.options).filter(o => o.value !== '');
    if (options.length > 0) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  if (options.length === 0) {
    console.warn('[Riven OCR] No options found in mod name select after waiting');
    return;
  }

  console.log('[Riven OCR] Found mod name options:', options.map(o => o.textContent));

  // 改进匹配逻辑：模糊匹配
  const targetName = modName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const matchingOption = options.find(option => {
    const optText = (option.textContent || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return optText.includes(targetName) || targetName.includes(optText);
  });

  if (matchingOption) {
    modNameSelect.value = matchingOption.value;
    triggerInputEvent(modNameSelect);
    console.log('[Riven OCR] Riven mod name set to:', matchingOption.textContent);
  } else {
    // 如果没找到完全包含的，尝试第一个候选项作为兜底（或者保持默认）
    console.warn('[Riven OCR] Riven mod name option not found, available options:', options.map(o => o.textContent));
  }
}

async function fillRanksAndPolarity(root: Document | HTMLElement, ocr: OcrRivenResult): Promise<void> {
  console.log('[Riven OCR] Filling ranks and polarity...');

  // 段位
  const masteryInput = root.querySelector('#auction-create__masteryRank') as HTMLInputElement;
  if (masteryInput && typeof ocr.mastery_level === 'number') {
    masteryInput.value = ocr.mastery_level.toString();
    triggerInputEvent(masteryInput);
    console.log('[Riven OCR] Mastery level set to:', ocr.mastery_level);
  }

  // Mod 等级 (默认 0)
  const modRankInput = root.querySelector('#auction-create__modRank') as HTMLInputElement;
  if (modRankInput) {
    const rankValue = typeof ocr.mod_rank === 'number' ? ocr.mod_rank : 0;
    modRankInput.value = rankValue.toString();
    triggerInputEvent(modRankInput);
    console.log('[Riven OCR] Mod rank set to:', rankValue);
  }

  // 重掷次数
  const rerollsInput = root.querySelector('#auction-create__reRolls') as HTMLInputElement;
  if (rerollsInput) {
    const rerollsValue = typeof ocr.re_rolls === 'number' ? ocr.re_rolls : 0;
    rerollsInput.value = rerollsValue.toString();
    triggerInputEvent(rerollsInput);
    console.log('[Riven OCR] Rerolls set to:', rerollsValue);
  }

  // 极性
  const polaritySelect = root.querySelector('#auctions-create__polarity') as HTMLSelectElement;
  if (polaritySelect && ocr.polarity && ocr.polarity !== 'unknown') {
    polaritySelect.value = ocr.polarity;
    triggerInputEvent(polaritySelect);
    console.log('[Riven OCR] Polarity set to:', ocr.polarity);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FILL_AUCTION_FORM') {
    // 必须返回 true 来启用异步响应
    (async () => {
      try {
        console.log('[Riven OCR] Received fill request:', message.payload);

        const ocr: OcrRivenResult = message.payload;
        console.log('[Riven OCR] Detected language:', detectLangFromUrl(location.href));

        const lang: Lang = detectLangFromUrl(location.href);
        console.log('[Riven OCR] Loading dictionary...');
        const dict = await loadDictionary();
        console.log('[Riven OCR] Dictionary loaded successfully');

        console.log('[Riven OCR] Opening auction modal...');
        // 打开拍卖模态框
        await openAuctionModalIfNeeded(document);

        // 等待模态框完全加载
        console.log('[Riven OCR] Waiting for modal to load...');
        await new Promise(resolve => setTimeout(resolve, 500));

        // 尝试获取模态框内容区域
        const modal = (document.querySelector('.widget-modal__content--DCGVm') || 
                       document.querySelector('.modal--Csf66.opened--LfN_k')) as HTMLElement;
        
        if (!modal) {
          console.error('[Riven OCR] Modal not found');
          throw new Error('未找到拍卖创建模态框');
        }
        console.log('[Riven OCR] Modal found, starting form filling...');

        // 预处理：清理已有的词条内容，防止干扰识别
        await clearExistingAttributes(modal);

        // 按顺序填充表单
        console.log('[Riven OCR] Filling category...');
        await fillCategory(modal);

        const weaponText = buildWeaponSearchText(ocr, dict, lang);
        console.log('[Riven OCR] Weapon search text:', weaponText);
        if (weaponText) {
          console.log('[Riven OCR] Filling weapon...');
          await fillWeapon(modal, weaponText);
        }

        // 过滤重复词条：按 url_name 去重，只保留第一个出现的
        const seenAttrs = new Set<string>();
        const positiveAttrs = ocr.attributes.filter(a => {
          if (a.positive && !seenAttrs.has(a.url_name)) {
            seenAttrs.add(a.url_name);
            return true;
          }
          return false;
        });

        console.log('[Riven OCR] Positive attributes (deduplicated):', positiveAttrs.length);
        await fillPositiveAttributes(modal, positiveAttrs, dict, lang);

        const negativeAttr = ocr.attributes.find(a => !a.positive);
        console.log('[Riven OCR] Negative attribute:', negativeAttr);
        if (negativeAttr) {
          await fillNegativeAttribute(modal, negativeAttr, dict, lang);
        }

        console.log('[Riven OCR] Filling ranks and polarity...');
        await fillRanksAndPolarity(modal, ocr);

        // 填充Riven Mod名称（如果有的话）
        if (ocr.name) {
          console.log('[Riven OCR] Filling riven mod name...');
          await fillRivenModName(modal, ocr.name);
        }

        console.log('[Riven OCR] Form filling completed successfully');
        sendResponse({ ok: true });
      } catch (error) {
        console.error('[Riven OCR] Fill form error:', error);
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        sendResponse({ ok: false, error: errorMessage });
      }
    })();
    return true; // 启用异步响应
  }
  return false;
});
