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

// 编辑距离函数，用于模糊匹配
function levenshteinDistance(str1: string, str2: string): number {
  const matrix = [];

  // 初始化矩阵
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  // 填充矩阵
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // 替换
          matrix[i][j - 1] + 1,     // 插入
          matrix[i - 1][j] + 1      // 删除
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
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
  // 尽量贴近真实输入：React 常依赖 input 事件
  try {
    element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, composed: true }));
  } catch {
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function triggerKeyupEvent(element: HTMLInputElement) {
  element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
}

function setNativeValue<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
  element: T,
  value: string
) {
  // 关键：使用原型上的 setter，避免 React/Vue 读不到 value 变更
  const proto = Object.getPrototypeOf(element);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc?.set) {
    desc.set.call(element, value);
  } else {
    (element as any).value = value;
  }
}

function parseOptionalNumberAttr(el: Element, attrName: 'min' | 'max' | 'step'): number | null {
  const v = (el as HTMLInputElement).getAttribute(attrName);
  if (!v || v === 'any') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatNumberAsEntered(value: number): string {
  // 按用户需求：不要按 0.1/step 四舍五入，直接填入识别值本身。
  // 这里只做最小清理：处理 -0 以及 NaN/Infinity。
  if (!Number.isFinite(value)) return '';
  const s = String(value);
  return s === '-0' ? '0' : s;
}

function computeNegativeValueForInput(rawValue: number, input: HTMLInputElement): number {
  // 按你的反馈：后端/识别结果返回的就是“页面该填的数值”，插件侧不要再做任何换算。
  // 同时为了贴近手动输入体验，这里统一写“绝对值”，符号交给页面自身在序列化/校验时处理。
  void input;
  return Math.abs(Number(rawValue));
}

function isElementVisible(el: Element): boolean {
  // 兼容：元素存在但被 display:none / visibility:hidden / opacity:0 / 尺寸为0 的情况
  const htmlEl = el as HTMLElement;
  const style = window.getComputedStyle(htmlEl);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = htmlEl.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

async function waitForVisibleElement(selector: string, timeout = 7000): Promise<Element> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const el = document.querySelector(selector);
    if (el && isElementVisible(el)) return el;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Visible element ${selector} not found within ${timeout}ms`);
}

async function waitForClassOnElement(el: Element, className: string, timeout = 7000): Promise<void> {
  if (el.classList.contains(className)) return;

  await new Promise<void>((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (el.classList.contains(className)) {
        observer.disconnect();
        resolve();
      }
    });

    observer.observe(el, { attributes: true, attributeFilter: ['class'] });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element did not receive class "${className}" within ${timeout}ms`));
    }, timeout);
  });
}

function simulateUserClick(el: Element) {
  const target = el as HTMLElement;
  target.focus?.();

  // React/现代站点常依赖 pointer 事件；尽量模拟完整序列
  const common = { bubbles: true, cancelable: true, composed: true };
  try {
    target.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    target.dispatchEvent(new PointerEvent('pointerup', { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  } catch {
    // 某些浏览器环境可能没有 PointerEvent
  }
  target.dispatchEvent(new MouseEvent('mousedown', common));
  target.dispatchEvent(new MouseEvent('mouseup', common));
  // 只触发一次 click：避免某些组件在“重复 click”下录入两次（会导致重复词条/空 value）
  target.click?.();
}

async function simulateTyping(input: HTMLInputElement, text: string) {
  input.focus();
  setNativeValue(input, text);
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
  // 只点击“可见”的项，避免点到隐藏的旧列表（这是重复录入的常见来源）
  const dropdownItems = Array.from(document.querySelectorAll(selector)).filter(isElementVisible);
  console.log('[Riven OCR] Found dropdown items:', dropdownItems.length);

  for (const item of Array.from(dropdownItems)) {
    const text = item.textContent?.trim();
    console.log('[Riven OCR] Checking dropdown item:', text);
    if (text && (text.toLowerCase().includes(searchText.toLowerCase()) || searchText.toLowerCase().includes(text.toLowerCase()))) {
      console.log('[Riven OCR] Clicking dropdown item:', text);
      const clickable =
        ((item as HTMLElement).closest('li.selectable') ||
          (item as HTMLElement).closest('li') ||
          (item as HTMLElement)) as HTMLElement;
      simulateUserClick(clickable);
      // 等待选择完成
      await new Promise(resolve => setTimeout(resolve, 100));
      return true;
    }
  }
  return false;
}

async function clearSelectedUnitsWithin(container: Element): Promise<void> {
  const selectedUnits = Array.from(container.querySelectorAll('.attribute-seeker__selected .selected-unit'));
  if (selectedUnits.length === 0) return;

  console.log('[Riven OCR] Clearing selected units within container:', selectedUnits.length);
  for (const unit of selectedUnits) {
    const removeBtn =
      (unit.querySelector('.btn') ||
        unit.querySelector('button') ||
        unit.querySelector('[role="button"]')) as HTMLElement | null;
    if (removeBtn) {
      simulateUserClick(removeBtn);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
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
  // 查找已选择词条的删除按钮（站点样式可能变动，选择器尽量宽松）
  const removeButtons = Array.from(
    root.querySelectorAll(
      '.attribute-seeker__selected .selected-unit .btn, ' +
        '.attribute-seeker__selected .selected-unit button, ' +
        '.attribute-seeker__selected .selected-unit [role="button"]'
    )
  ) as HTMLElement[];
  
  if (removeButtons.length > 0) {
    console.log(`[Riven OCR] Found ${removeButtons.length} attributes to clear`);
    for (const btn of removeButtons) {
      simulateUserClick(btn);
      // 每次点击后稍微等待，让网页更新 DOM
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

// DOM 填充函数
async function openAuctionModalIfNeeded(root: Document | HTMLElement): Promise<void> {
  console.log('[Riven OCR] Checking if auction modal needs to be opened...');

  // 以 warframe.market 的状态类为准：.modal--Csf66 + opened--LfN_k 代表“真正打开”
  const alreadyOpened = document.querySelector('.modal--Csf66.opened--LfN_k');
  if (alreadyOpened) {
    console.log('[Riven OCR] Auction modal already opened');
    return;
  }

  // 只允许通过官方按钮打开，避免绕过网站内部初始化逻辑导致提交 400
  const createButton =
    (document.querySelector('.auction-create__button[role="button"]') ||
      document.querySelector('.auction-create__button')) as HTMLElement | null;
  if (!createButton) {
    console.error('[Riven OCR] Create auction button not found');
    throw new Error('未找到创建拍卖按钮，请确保已登录并处于正确的页面');
  }

  // modal 容器一般常驻 DOM（即使未打开）；如果不存在则等待其出现
  let modalContainer = document.querySelector('.modal--Csf66') as HTMLElement | null;
  if (!modalContainer) {
    modalContainer = (await waitForElement('.modal--Csf66', 7000)) as HTMLElement;
  }

  console.log('[Riven OCR] Clicking create auction button...');
  simulateUserClick(createButton);

  // 等待 opened class 出现 —— 这是“点击打开成功”的最准信号
  await waitForClassOnElement(modalContainer, 'opened--LfN_k', 7000);

  console.log('[Riven OCR] Auction modal opened and ready');
}

async function fillCategory(root: Document | HTMLElement): Promise<void> {
  console.log('[Riven OCR] Filling category...');
  const categorySelect = root.querySelector('#auction-create__auctionCategory') as HTMLSelectElement;
  if (categorySelect) {
    setNativeValue(categorySelect, 'riven'); // 设置为裂罅 Mod
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
        const selected = await selectFromDropdown(container, dropdownInputs, searchText, 'li.selectable span');
        if (!selected) {
          console.warn('[Riven OCR] Positive attribute not selected, skip value input:', attr.url_name);
          continue;
        }
      }
    }

    if (valueInput) {
      const v = Math.abs(Number(attr.value));
      let finalValue = v;
      // 特殊处理：后坐力(recoil)作为正面属性时，数值应为负（-后坐力是正面效果）
      if (attr.url_name === 'recoil') {
        finalValue = -v;
      }
      setNativeValue(valueInput, formatNumberAsEntered(finalValue));
      triggerInputEvent(valueInput);
      triggerKeyupEvent(valueInput);
      valueInput.dispatchEvent(new Event('blur', { bubbles: true }));
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

  // 关键：只清理负面容器自己的已选词条，防止残留导致 payload 出现“重复负面 + 一条没 value”
  await clearSelectedUnitsWithin(negativeContainer);

  // 点击action按钮打开dropdown
  const actionButton = negativeContainer.querySelector('.attribute-seeker__action') as HTMLButtonElement;
  if (actionButton) {
    actionButton.click();
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // 填充属性
  const dropdownInputs = negativeContainer.querySelector('.attribute-seeker__dropdown .dropdown__inputs .real-input input') as HTMLInputElement;
  const valueInput =
    (negativeContainer.querySelector('input[id^="auction-create__value_negative"]') ||
      root.querySelector('#auction-create__value_negative')) as HTMLInputElement;

  if (dropdownInputs) {
    const searchText = buildAttributeSearchText(attr.url_name, dict, lang);
    if (searchText) {
      const selected = await selectFromDropdown(negativeContainer, dropdownInputs, searchText, 'li.selectable span');
      if (!selected) {
        console.warn('[Riven OCR] Negative attribute not selected, skip value input:', attr.url_name);
        return;
      }
    }
  }

  if (valueInput) {
    // 根据不同负面输入框（倍率 x / 百分比减法）写入正确的数值范围与符号
    const max = parseOptionalNumberAttr(valueInput, 'max');
    const abs = Math.abs(Number(attr.value));
    let computed = max !== null && max <= 0 ? -abs : abs;
    // 特殊处理：后坐力(recoil)作为负面属性时，数值应为正（+后坐力是负面效果）
    if (attr.url_name === 'recoil') {
      computed = abs;
    }
    setNativeValue(valueInput, formatNumberAsEntered(computed));
    triggerInputEvent(valueInput);
    triggerKeyupEvent(valueInput);
    valueInput.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // 兜底：如果依然出现多个 selected-unit，删除到只剩 1 个（避免提交 invalid_form）
  const afterUnits = Array.from(negativeContainer.querySelectorAll('.attribute-seeker__selected .selected-unit'));
  if (afterUnits.length > 1) {
    console.warn('[Riven OCR] Multiple negative selected units detected, trimming:', afterUnits.length);
    for (let i = 0; i < afterUnits.length - 1; i++) {
      const unit = afterUnits[i];
      const removeBtn =
        (unit.querySelector('.btn') ||
          unit.querySelector('button') ||
          unit.querySelector('[role="button"]')) as HTMLElement | null;
      if (removeBtn) {
        simulateUserClick(removeBtn);
        await new Promise((r) => setTimeout(r, 100));
      }
    }
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

  // 改进匹配逻辑：模糊匹配，支持编辑距离
  const targetName = modName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const matchingOption = options.find(option => {
    const optText = (option.textContent || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // 完全匹配
    if (optText === targetName) return true;

    // 包含关系匹配
    if (optText.includes(targetName) || targetName.includes(optText)) return true;

    // 编辑距离匹配（允许1-2个字符差异）
    const distance = levenshteinDistance(optText, targetName);
    return distance <= Math.min(2, Math.max(1, Math.floor(targetName.length * 0.3)));
  });

  if (matchingOption) {
    setNativeValue(modNameSelect, matchingOption.value);
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
    setNativeValue(masteryInput, ocr.mastery_level.toString());
    triggerInputEvent(masteryInput);
    masteryInput.dispatchEvent(new Event('blur', { bubbles: true }));
    console.log('[Riven OCR] Mastery level set to:', ocr.mastery_level);
  }

  // Mod 等级 (默认 0)
  const modRankInput = root.querySelector('#auction-create__modRank') as HTMLInputElement;
  if (modRankInput) {
    const rankValue = typeof ocr.mod_rank === 'number' ? ocr.mod_rank : 0;
    setNativeValue(modRankInput, rankValue.toString());
    triggerInputEvent(modRankInput);
    modRankInput.dispatchEvent(new Event('blur', { bubbles: true }));
    console.log('[Riven OCR] Mod rank set to:', rankValue);
  }

  // 重掷次数
  const rerollsInput = root.querySelector('#auction-create__reRolls') as HTMLInputElement;
  if (rerollsInput) {
    const rerollsValue = typeof ocr.re_rolls === 'number' ? ocr.re_rolls : 0;
    setNativeValue(rerollsInput, rerollsValue.toString());
    triggerInputEvent(rerollsInput);
    rerollsInput.dispatchEvent(new Event('blur', { bubbles: true }));
    console.log('[Riven OCR] Rerolls set to:', rerollsValue);
  }

  // 极性
  const polaritySelect = root.querySelector('#auctions-create__polarity') as HTMLSelectElement;
  if (polaritySelect && ocr.polarity && ocr.polarity !== 'unknown') {
    setNativeValue(polaritySelect, ocr.polarity);
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

        // 等待模态框完全加载：以 opened 状态的 modal 容器为 root（不依赖 hash class）
        console.log('[Riven OCR] Waiting for opened modal container...');
        const modal = document.querySelector('.modal--Csf66.opened--LfN_k') as HTMLElement | null;
        
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
