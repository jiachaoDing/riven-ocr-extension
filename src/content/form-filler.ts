// src/content/form-filler.ts
import { 
  OcrRivenResult, 
  Lang, 
  RivenDictionary, 
  DictEntry,
  OcrAttribute
} from '../shared/types';
import { 
  getWeaponEntry, 
  getAttributeEntry 
} from '../shared/dictionary';
import { 
  waitForElement, 
  waitForClassOnElement, 
  simulateUserClick, 
  setNativeValue, 
  triggerInputEvent, 
  triggerKeyupEvent, 
  formatNumberAsEntered, 
  parseOptionalNumberAttr,
  levenshteinDistance
} from './utils';
import { 
  selectFromDropdown, 
  clearSelectedUnitsWithin, 
  clearExistingAttributes 
} from './dom-utils';

export function buildWeaponSearchText(ocr: OcrRivenResult, dict: RivenDictionary, lang: Lang): string | null {
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

export function buildAttributeSearchText(urlName: string, dict: RivenDictionary, lang: Lang): string | null {
  const entry = getAttributeEntry(urlName, dict);
  if (!entry) return urlName; // fallback to url_name
  return entry.names[lang][0] || urlName;
}

export async function openAuctionModalIfNeeded(): Promise<void> {
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
    const isZh = document.documentElement.lang === 'zh' || location.href.includes('/zh-hans/');
    throw new Error(isZh ? '未找到创建拍卖按钮，请确保已登录并处于正确的页面' : 'Create auction button not found. Please ensure you are logged in and on the correct page.');
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

export async function fillCategory(root: Document | HTMLElement): Promise<void> {
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

export async function fillWeapon(root: Document | HTMLElement, weaponSearchText: string): Promise<void> {
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

export async function fillPositiveAttributes(root: Document | HTMLElement, attrs: OcrAttribute[], dict: RivenDictionary, lang: Lang): Promise<void> {
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

export async function fillNegativeAttribute(root: Document | HTMLElement, attr: OcrAttribute, dict: RivenDictionary, lang: Lang): Promise<void> {
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

export async function fillRivenModName(root: Document | HTMLElement, modName: string): Promise<void> {
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
  const targetName = modName.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
  const matchingOption = options.find(option => {
    const optText = (option.textContent || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');

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

export async function fillRanksAndPolarity(root: Document | HTMLElement, ocr: OcrRivenResult): Promise<void> {
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

export async function fillAuctionForm(ocr: OcrRivenResult, dict: RivenDictionary, lang: Lang): Promise<void> {
  // 打开拍卖模态框
  await openAuctionModalIfNeeded();

  // 等待模态框完全加载：以 opened 状态的 modal 容器为 root（不依赖 hash class）
  console.log('[Riven OCR] Waiting for opened modal container...');
  const modal = document.querySelector('.modal--Csf66.opened--LfN_k') as HTMLElement | null;
  
  if (!modal) {
    console.error('[Riven OCR] Modal not found');
    const isZh = lang === 'zh';
    throw new Error(isZh ? '未找到拍卖创建模态框' : 'Auction creation modal not found.');
  }
  console.log('[Riven OCR] Modal found, starting form filling...');

  // 预处理：清理已有的词条内容，防止干扰识别
  await clearExistingAttributes(modal);

  // 按顺序填充表单
  console.log('[Riven OCR] Filling category...');
  await fillCategory(modal);

  const weaponSearchText = buildWeaponSearchText(ocr, dict, lang);
  if (weaponSearchText) {
    console.log('[Riven OCR] Filling weapon...');
    await fillWeapon(modal, weaponSearchText);
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
}
