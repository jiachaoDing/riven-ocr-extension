# riven-ocr-extension

**Riven OCR Assistant** is a browser extension designed specifically for Warframe players. It uses advanced OCR (Optical Character Recognition) technology to greatly simplify the process of listing Riven Mods (purple cards) on the `warframe.market` platform.

### 🌟 Core Features

*   **Smart Image Recognition**: Supports quick import of Riven screenshots through **clipboard paste**, **drag-and-drop upload**, or **file selection**.
*   **High-Precision Parsing**: Based on PaddleOCR and FastAPI backend services, accurately recognizes all core Riven data including weapon name, Riven name, polarity, mastery requirements, rerolls count, mod level, and all positive and negative attributes.
*   **Bilingual Support**: Built-in complete weapon and attribute dictionaries for both Chinese and English, enabling seamless switching between Chinese and English `warframe.market` interfaces.
*   **One-Click Auto-Fill**: After successful recognition, automatically fills data into the `warframe.market` auction creation form with one click. Handles category selection, dropdown matching, and value input automatically - users only need to make final confirmation.
*   **Market Price Integration**: Displays yesterday's average minimum prices from `Riven Tracker` below recognition results to help players quickly set reasonable prices.

### 🚀 Technology Stack

*   **Frontend Framework**: TypeScript + Vite (Manifest V3)
*   **Core Logic**: Browser-based Service Worker for asynchronous processing and Content Script for automated operations.
*   **Storage Mechanism**: Uses `chrome.storage.sync` for user configuration synchronization and `chrome.storage.local` for caching recognition history and dictionary data.
*   **Backend Support**: Accompanied by [Riven-OCR-Backend](https://github.com/your-repo/riven-ocr-backend) (based on FastAPI + PaddleOCR).

### 🛠️ Installation and Usage

1.  **Backend Setup**: Ensure your OCR backend service is running (supports local deployment or remote server).
2.  **Extension Configuration**: Configure the correct backend URL in the extension settings page.
3.  **Start Recognition**: On the `warframe.market` auction page, open the extension popup and paste your Riven screenshot.
4.  **Write to Page**: After confirming the recognition results are correct, click "Write to Page" and watch the form auto-fill.

### 🔒 Security and Compliance

This extension only assists with form filling and **does not automatically submit auction requests**, fully complying with `warframe.market`'s usage policies to ensure player account security.