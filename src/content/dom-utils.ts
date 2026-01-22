// src/content/dom-utils.ts
import { isElementVisible, simulateUserClick, simulateTyping } from './utils';

export async function selectFromDropdown(root: Element, input: HTMLInputElement, searchText: string, selector = 'li.selectable span') {
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

export async function clearSelectedUnitsWithin(container: Element): Promise<void> {
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

export async function clearExistingAttributes(root: Document | HTMLElement): Promise<void> {
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
