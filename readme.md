# Riven-OCR 浏览器插件前端设计文档

> 版本：v1
> 适用平台：Chrome / Edge / 其他基于 Chromium 的浏览器（Manifest V3）

---

## 1. 背景与目标

### 1.1 项目背景

整体系统架构是：

* **浏览器插件（前端壳）**：负责截图输入、本地字典匹配、结果展示，以及与 warframe.market 的交互。
* **Riven-OCR 后端服务**：基于 FastAPI + PaddleOCR，实现自动裁剪、极性识别、蓝点检测和词条解析。
* **本地中英字典**：武器 / 词条中英映射，辅助前后端纠错与标准化。

后端已提供统一 API：

* `POST /api/v1/riven/parse` — 文件上传解析
* `POST /api/v1/riven/parse-base64` — Base64 图片解析
* `GET /health/` — 健康检查

解析结果为标准 JSON，包含武器名、紫卡名、段位、极性、Mod 等级和词条数组：

```json
{
  "weapon_url_name": "torid",
  "weapon_name": "托里德",
  "name": "Ampi-saticon",
  "mastery_level": 15,
  "polarity": "madurai",
  "mod_rank": 8,
  "attributes": [
    {
      "url_name": "ammo_maximum",
      "value": 62.1,
      "positive": true
    }
  ],
  "type": "riven",
  "confidence": 1.0
}
```

### 1.2 插件目标

1. 在浏览器中**接收紫卡截图**（拖拽 / 粘贴 / 选择文件）；
2. 调用后端 OCR 服务，获取**结构化 Riven JSON**；
3. 在插件 UI 中**可视化展示并微调**识别结果（中英字典辅助纠错）；
4. 在 `https://warframe.market/zh-hans/auctions/` 的“创建拍卖”弹窗里**自动填表**，用户只负责最后确认。

约束：

* 不自动提交拍卖表单（避免违反平台规则）；
* 前端逻辑尽量轻量，复杂解析都在后端完成。

---

## 2. 前端整体架构

### 2.1 插件结构（Manifest V3）

核心组成：

1. **Service Worker（后台脚本）**

   * 统一网络请求（调用 OCR 后端）；
   * 维护最近一次识别结果缓存；
   * 负责与 Popup、Content Script 的消息中转。

2. **Popup 页面**

   * 用户主要入口：上传图片 / 查看与编辑识别结果 / 触发自动填表；
   * 可提供到价格历史站点的链接（后续扩展）。

3. **Content Script**

   * 注入到 `https://warframe.market/*`；
   * 操作 DOM：打开“创建拍卖”弹窗并自动填写各字段。

4. **Options 页面**

   * 后端地址配置（本地 / 线上）；
   * 字典更新策略；
   * 一些自动行为开关（如自动打开拍卖页面、自动补满正面词条行数）。

5. **共享工具模块**

   * 字典加载与查询；
   * 语言检测；
   * DOM 工具（等待元素、触发 input/change 事件、简易日志输出）。

---

## 3. 核心数据结构

### 3.1 后端 Riven 响应结构（简化 TS 定义）

```ts
interface OcrAttribute {
  url_name: string;   // "ammo_maximum"
  value: number;      // 62.1 (绝对值)
  positive: boolean;  // true -> 正面词条，false -> 负面词条
}

interface OcrRivenResult {
  weapon_url_name?: string;
  weapon_name?: string;
  name?: string;            // Riven mod 名称，如 "Ampi-saticon"
  mastery_level?: number;   // 段位
  polarity?: 'madurai' | 'naramon' | 'vazarin' | 'unknown';
  mod_rank?: number;        // 蓝点数
  attributes: OcrAttribute[];
  type: 'riven';
  confidence: number;
}
```

> 基于后端文档中提供的 JSON 结构。

### 3.2 前端字典结构

你已经确定了前端的字典 JSON 结构：

```ts
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
```

* `weapon_dict`：key 为 `weapon_url_name`，value 包含多个中英别名；
* `attribute_dict`：key 为属性 `url_name`（如 `critical_chance`），value 包含显示用中英名称。

---

## 4. 功能设计与用户流程

### 4.1 主流程：从截图到自动填表

1. 用户打开 warframe.market 拍卖页面。
2. 点击浏览器工具栏图标，弹出插件 Popup。
3. 用户通过以下任一方式输入截图：

   * 拖拽图片到上传区域；
   * 点击选择图片；
   * 在游戏内截图后，Ctrl+C / 截图工具复制 → 在 Popup 中 Ctrl+V 粘贴。
4. Popup 将图片（或 Base64）发送给 Service Worker，后者调用后端 `/api/v1/riven/parse` 或 `/parse-base64`。
5. Service Worker 接收解析结果并返回 Popup，Popup 显示结构化 Riven 信息，低置信度字段做高亮提示。
6. Popup 利用本地字典做中英映射 & 校验，允许用户对武器名、词条和数值进行编辑。
7. 用户点击「写入 warframe.market」：

   * Popup 获取当前活跃标签页；
   * 通过 `chrome.tabs.sendMessage` 发送 `{ type: 'FILL_AUCTION_FORM', payload: rivenData }` 给 Content Script。
8. Content Script 检查当前页面：

   * 若没打开“创建拍卖”弹窗，则点击 `.auction-create__button-circle` 打开。
   * 等待弹窗表单渲染完成后，根据 `payload` 内容自动填写：

     * 类别选择、武器名称、正面词条、负面词条、数值、段位、MOD 等级、极性等。
9. 填写完成后插件退出，最终点击「下一项」由用户自己操作，不自动提交。

### 4.2 辅助流程

* 检查后端健康状态（从 Options 或 Popup 触发 `/health/` 请求）；
* 在 Popup 中展示最近识别历史（保存在 `chrome.storage.local`）；
* 一键打开 / 跳转到拍卖页面；
* （未来）联动你的底价查询站：从识别结果生成底价历史查询链接。

---

## 5. 模块设计

### 5.1 Popup 页面

**技术栈建议：**

* TypeScript + 你熟悉的框架（如 Vue3），或直接 TS + 原生 DOM。

**主要组件：**

1. **ImageInput**

   * 负责三种输入方式：

     * `<input type="file" accept="image/*">`
     * `dragover/drop` 监听；
     * `paste` 监听 Clipboard 中的 image。
   * 可选：对图片进行压缩/尺寸限制，降低传输开销。

2. **ParseStatus**

   * 状态枚举：`idle | uploading | parsing | success | error`；
   * 展示 loading、错误提示和重试按钮。

3. **RivenResultForm**

   * 显示并可编辑 `OcrRivenResult`：

     * 武器：下拉或输入，自动联想（使用 `weapon_dict`）；
     * 词条：列表展示，正面 / 负面用颜色区分；
     * 段位、极性、MOD 等级、循环次数；
   * 对 `confidence < 阈值` 的字段，添加 “低置信度” 标记。

4. **ActionButtons**

   * 「重新识别」：重新发起 OCR；
   * 「写入 warframe.market」：向 Content Script 发送填表请求；
   * 「打开拍卖页」：`chrome.tabs.create({ url: 'https://warframe.market/zh-hans/auctions/' })`。

5. **设置入口**

   * 链接到 Options 页面（后端地址和字典设置）。

### 5.2 Service Worker（后台）

**职责：**

1. 消息路由：

   * 接收 Popup 请求：

     * `PARSE_IMAGE`（附带 Blob/Base64）；
     * `GET_LAST_RESULT`；
   * 转发给 Content Script 的消息（如必要时广播）。

2. 后端调用：

   * 通过 `fetch` 调用 `/api/v1/riven/parse` 或 `/parse-base64`；
   * 基础 URL 从 `chrome.storage.sync` 读取（Options 页面配置，默认本地 `http://127.0.0.1:8000`）。 

3. 错误处理：

   * 超时、网络错误、非 2xx 响应统一封装为标准错误结构返回；
   * 视情况将错误信息日志化（console + Popup 提示）。

4. 结果缓存：

   * 存储最近一次成功的 `OcrRivenResult`，确保 Popup 关闭重开后仍可获取。

### 5.3 Content Script（warframe.market 集成）

**注入范围：**

* Manifest 中配置：

  * `"matches": ["https://warframe.market/*"]`

**主要职责：**

1. 监听来自后台/Popup 的消息：

   * `FILL_AUCTION_FORM`：自动填入拍卖创建表单；
   * 后续可扩展为 `FOCUS_AUCTION_MODAL` 等其他指令。

2. 弹窗与表单定位

   * 检查是否已存在 `.widget-modal__content--DCGVm`（创建拍卖弹窗）。
   * 若不存在：

     * 查找 `.auction-create__button-circle` 并点击打开。
     * 使用轮询或 MutationObserver 等待弹窗元素出现。

3. 字段填充逻辑（基于 html 参考）

> 以下 DOM 结构取自你提供的 `html参考.md`。

#### 5.3.1 类别选择

* DOM：`<select id="auction-create__auctionCategory">`，选项包括「已揭示的裂罅Mod / 赤毒玄骸 / 帕尔沃斯的姐妹」。
* 操作：

  * 设置 value 为 `'riven'`；
  * 触发 `change` 事件。

#### 5.3.2 武器名称（item-seeker）

结构大致为：

```html
<div class="form-group--Rtw_c">
  <label for="auction-create__itemName">武器名称</label>
  <div class="item-seeker">
    <section class="item-seeker__input">
      <span class="real-input"><input type="text" placeholder="."></span>
      ...
    </section>
    <button class="btn item-seeker__action" type="button">...</button>
  </div>
</div>
```

行为：

* 点击 `.item-seeker__action` 或 input 会使容器 class 变为 `.item-seeker foucused`，生成 dropdown：

```html
<section class="item-seeker__dropdown limitedHeight">
  <ul>
    <li class="group_name">Archwing枪械</li>
    <li class="selectable"><span>惩戒者</span></li>
    ...
  </ul>
</section>
```

**填充策略（配合字典）：**

1. 根据当前 URL 判断语言：

   * `https://warframe.market/zh-hans/...` → `lang = 'zh'`；
   * 其他 → `lang = 'en'`。

2. 利用字典找到武器显示名称：

   * 若后端返回 `weapon_url_name`，在 `weapon_dict` 中查找；
   * 否则用 `weapon_name` 做模糊匹配；
   * 从 `entry.names[lang]` 中取第一个作为搜索关键词。

3. DOM 操作过程：

   * 点击 `.item-seeker__action` 打开 dropdown；
   * 把关键词写入真实 input，并触发 `input`/`keyup` 事件；
   * 延时 100–300ms 后遍历 `.item-seeker__dropdown li.selectable span`，按文本 `includes` 匹配，找到最合适的一项并点击。

#### 5.3.3 正面词条（attribute-seeker）

DOM 结构：

```html
<div class="form-group--Rtw_c auction-create__stats row compact">
  <div class="d-flex flex-column align-items-stretch col-8 col-sm-8">
    <label class="positive_label">正面词条</label>
    <div class="attribute-seeker minimalistic">
      <section class="attribute-seeker__selected">
        <div class="attribute-seeker__placeholder">.</div>
      </section>
      <button class="btn attribute-seeker__action" type="button">...</button>
    </div>
  </div>
  <div class="d-flex flex-column align-items-stretch col-4 col-sm-3">
    <div class="form-control--uQav7 form-input--yMF_l">
      <input type="number" id="auction-create__value_0" ...>
    </div>
  </div>
</div>
```

当 attribute-seeker 为 focused 状态时：

```html
<div class="attribute-seeker focused minimalistic">
  <section class="attribute-seeker__dropdown">
    <section class="dropdown__inputs">
      <span class="real-input"><input type="text"></span>
      ...
    </section>
    <ul>
      <li class="group_name empty"></li>
      <li class="selectable"><span>暴击率</span></li>
      ...
    </ul>
  </section>
</div>
```

**填充策略：**

1. 正面词条来自 `attributes.filter(attr => attr.positive)`；
2. 若正面词条数量 > 1，需要点击 “+ 增加” 按钮扩充表单行数：

   * 按钮：`<button class="btn btn__light--c9XBJ"><span>+ 增加</span></button>`
3. 每一行填充流程：

   * 找到对应 `.attribute-seeker` 容器和数值输入框 `#auction-create__value_i`；
   * 点击 `.attribute-seeker__action` 打开 dropdown；
   * 利用 `attribute_dict[attr.url_name].names[lang][0]` 作为搜索关键词填入 text input；
   * 在 `li.selectable span` 中模糊匹配后点击；
   * 写入数值到 `#auction-create__value_i`。

#### 5.3.4 负面词条

DOM：

```html
<div class="attribute-seeker minimalistic negative">...</div>
<input type="number" disabled id="auction-create__value_negative" ...>
```

* 逻辑类似正面词条，只是：

  * 使用 `attributes.find(attr => !attr.positive)` 作为负面；
  * attribute-seeker class 为 `.attribute-seeker minimalistic negative`；
  * 选择属性后，负面数值输入框的 `disabled` 会被移除，再写入负值或按站点逻辑写正值。

#### 5.3.5 Riven Mod 名称

* DOM：`<select id="auctions-create__modName" class="form-control--uQav7" ...>`
* 只有在属性选择完后才会出现 options：
* 若后端提供 `name`，则在 option 列表中按 `textContent.includes(name)` 匹配，并设为选中。

#### 5.3.6 段位 / Mod 等级 / 循环次数 / 极性

取自 HTML：

```html
<input type="number" id="auction-create__masteryRank" ...>
<input type="number" id="auction-create__modRank" ...>
<input type="number" id="auction-create__reRolls" ...>
<select id="auctions-create__polarity" class="unicode-icons__polarities">
  <option value="madurai">...</option>
  <option value="vazarin">...</option>
  <option value="naramon">...</option>
</select>
```

填充规则：

* 段位：写入 `mastery_level`；
* Mod 等级：写入 `mod_rank`；
* 循环次数：后端暂未提供，可默认 0 或沿用用户上一次输入；
* 极性：根据 `polarity` 设置 select 的 value（`madurai / vazarin / naramon` 等）。

### 5.4 Options 页面

**功能：**

* 配置后端基础 URL；
* 显示当前字典版本；
* 可选：从远端拉取最新字典 JSON，更新本地存储；
* 自动行为开关（如是否自动点 “+ 增加” 以补满正面词条行数）。

---

## 6. 字典模块设计与使用

### 6.1 字典加载

统一封装 `dictionary.ts`：

```ts
export type Lang = 'en' | 'zh';

let dict: RivenDictionary | null = null;

export async function loadDictionary(): Promise<RivenDictionary> {
  if (dict) return dict;
  const res = await fetch(chrome.runtime.getURL('data/dictionary.json'));
  dict = await res.json();
  return dict!;
}
```

Popup / Content Script 都通过该模块获取字典。

### 6.2 语言检测

根据当前 tab 的 URL 做非常简单的判断：

```ts
export function detectLangFromUrl(url: string): Lang {
  return url.includes('/zh-hans/') ? 'zh' : 'en';
}
```

### 6.3 武器映射

典型流程：

1. 若有 `weapon_url_name` → `weapon_dict[weapon_url_name]`；
2. 否则用 `weapon_name` 在所有 `names.en` + `names.zh` 中模糊匹配；
3. 结果中的 `entry.names[lang][0]` 作为填入 warframe.market 搜索框的关键词。

### 6.4 属性映射

* 直接通过 `attribute_dict[attr.url_name]` 获取属性字典项；
* `names[lang][0]` 用于 attribute-seeker dropdown 搜索；
* 为兼容 DOM 文本包含更多描述（如“对感染体暴击率”），匹配时使用 `includes` 或更宽松的模糊匹配。

---

## 7. 存储与配置

### 7.1 chrome.storage.sync

用于多设备同步的配置项：

* `backendBaseUrl`：后端服务地址；
* 一些轻量级布尔配置（自动补行数、是否默认打开拍卖页等）。

### 7.2 chrome.storage.local

用于本地缓存：

* 最近一次识别结果；
* 最近 N 条识别历史记录；
* 远程更新后的字典 JSON（以便热更新）。

---

## 8. 权限、安全与合规

### 8.1 Manifest 权限

* `"host_permissions": ["https://warframe.market/*"]`
* `"permissions": ["storage", "activeTab", "scripting"]`

### 8.2 安全策略

* **不自动提交表单**：仅自动填写字段，最后点击「下一项/确认」由用户执行。
* 仅在用户点击「写入」按钮后才注入/调用自动填表逻辑；
* 不擅自在非指定域名上注入敏感逻辑；
* 只上传用户明确提交的图片，不额外采集浏览记录或其他隐私数据。

---

## 9. 错误处理 & 调试策略

1. **后端错误**

   * 无法连接 / 超时 / HTTP 错误：

     * Popup 显示统一错误提示 “后端不可用，请检查服务或配置地址”；
2. **识别结果异常**

   * 字段缺失或 `attributes` 为空：

     * UI 中用警告标记，鼓励用户手工填；
3. **DOM 结构变化**

   * Content Script 在查找关键元素（如 `.auction-create__button-circle`、`#auction-create__masteryRank` 等）失败时：

     * 显示 overlay 或 alert 提示 “无法识别拍卖表单结构，网站可能更新，请等待插件更新”。

---

## 10. 后续扩展方向

* 支持多个市场站点：通过抽象 `MarketAdapter` 层，warframe.market 作为第一个实现。
* 在 Popup 内嵌价格历史查询（利用你已经做好的底价查询站）；
* 字典热更新：Options 页一键从你的服务器拉新版字典；
* 增加 “智能提示”：根据词条与底价判断当前卡的价值区间（纯计算展示，不自动定价）。

