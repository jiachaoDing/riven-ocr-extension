// src/content/utils.ts

// 编辑距离函数，用于模糊匹配
export function levenshteinDistance(str1: string, str2: string): number {
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

export function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+|·|\./g, '');
}

// DOM 操作工具函数
export function waitForElement(selector: string, timeout = 5000): Promise<Element> {
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

export function triggerInputEvent(element: HTMLInputElement | HTMLSelectElement) {
  // 尽量贴近真实输入：React 常依赖 input 事件
  try {
    element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, composed: true }));
  } catch {
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

export function triggerKeyupEvent(element: HTMLInputElement) {
  element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
}

export function setNativeValue<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
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

export function parseOptionalNumberAttr(el: Element, attrName: 'min' | 'max' | 'step'): number | null {
  const v = (el as HTMLInputElement).getAttribute(attrName);
  if (!v || v === 'any') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function formatNumberAsEntered(value: number): string {
  // 按用户需求：不要按 0.1/step 四舍五入，直接填入识别值本身。
  // 这里只做最小清理：处理 -0 以及 NaN/Infinity。
  if (!Number.isFinite(value)) return '';
  const s = String(value);
  return s === '-0' ? '0' : s;
}

export function computeNegativeValueForInput(rawValue: number, input: HTMLInputElement): number {
  // 按你的反馈：后端/识别结果返回的就是“页面该填的数值”，插件侧不要再做任何换算。
  // 同时为了贴近手动输入体验，这里统一写“绝对值”，符号交给页面自身在序列化/校验时处理。
  void input;
  return Math.abs(Number(rawValue));
}

export function isElementVisible(el: Element): boolean {
  // 兼容：元素存在但被 display:none / visibility:hidden / opacity:0 / 尺寸为0 的情况
  const htmlEl = el as HTMLElement;
  const style = window.getComputedStyle(htmlEl);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = htmlEl.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export async function waitForVisibleElement(selector: string, timeout = 7000): Promise<Element> {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const el = document.querySelector(selector);
    if (el && isElementVisible(el)) return el;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Visible element ${selector} not found within ${timeout}ms`);
}

export async function waitForClassOnElement(el: Element, className: string, timeout = 7000): Promise<void> {
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

export function simulateUserClick(el: Element) {
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

export async function simulateTyping(input: HTMLInputElement, text: string) {
  input.focus();
  setNativeValue(input, text);
  triggerInputEvent(input);
  triggerKeyupEvent(input);
  // 等待下拉列表渲染
  await new Promise(resolve => setTimeout(resolve, 100));
}
