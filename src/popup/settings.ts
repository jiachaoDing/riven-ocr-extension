// src/popup/settings.ts
import { getSyncSettings, setSyncSettings, testBackendConnection } from '../shared/storage';
import { loadDictionary } from '../shared/dictionary';

export class SettingsManager {
  private mainView: HTMLDivElement;
  private settingsView: HTMLDivElement;
  private settingsIcon: SVGElement;
  private backIcon: SVGElement;
  private currentView: 'main' | 'settings' = 'main';

  // Elements
  private backendUrlInput: HTMLInputElement;
  private marketPriceUrlInput: HTMLInputElement;
  private backendStatus: HTMLDivElement;
  private testBackendBtn: HTMLButtonElement;
  private saveBackendBtn: HTMLButtonElement;
  private dictVersion: HTMLDivElement;
  private dictStatus: HTMLDivElement;
  private updateDictBtn: HTMLButtonElement;
  private autoFillRowsCheckbox: HTMLInputElement;
  private autoOpenModalCheckbox: HTMLInputElement;
  private saveSettingsBtn: HTMLButtonElement;

  constructor() {
    this.mainView = document.getElementById('main-view') as HTMLDivElement;
    this.settingsView = document.getElementById('settings-view') as HTMLDivElement;
    this.settingsIcon = document.getElementById('settings-icon') as unknown as SVGElement;
    this.backIcon = document.getElementById('back-icon') as unknown as SVGElement;

    this.backendUrlInput = document.getElementById('backend-url') as HTMLInputElement;
    this.marketPriceUrlInput = document.getElementById('market-price-url') as HTMLInputElement;
    this.backendStatus = document.getElementById('backend-status') as HTMLDivElement;
    this.testBackendBtn = document.getElementById('test-backend') as HTMLButtonElement;
    this.saveBackendBtn = document.getElementById('save-backend') as HTMLButtonElement;
    this.dictVersion = document.getElementById('dict-version') as HTMLDivElement;
    this.dictStatus = document.getElementById('dict-status') as HTMLDivElement;
    this.updateDictBtn = document.getElementById('update-dict') as HTMLButtonElement;
    this.autoFillRowsCheckbox = document.getElementById('auto-fill-rows') as HTMLInputElement;
    this.autoOpenModalCheckbox = document.getElementById('auto-open-modal') as HTMLInputElement;
    this.saveSettingsBtn = document.getElementById('save-settings') as HTMLButtonElement;

    this.initEventListeners();
  }

  private initEventListeners() {
    this.testBackendBtn.addEventListener('click', () => this.handleTestConnection());
    this.saveBackendBtn.addEventListener('click', () => this.handleSaveBackend());
    this.updateDictBtn.addEventListener('click', () => this.handleUpdateDict());
    this.saveSettingsBtn.addEventListener('click', () => this.handleSaveAllSettings());
  }

  public toggleView() {
    this.switchView(this.currentView === 'main' ? 'settings' : 'main');
  }

  private switchView(view: 'main' | 'settings') {
    this.currentView = view;
    if (view === 'main') {
      this.mainView.classList.add('active');
      this.settingsView.classList.remove('active');
      this.settingsIcon.classList.remove('hidden');
      this.backIcon.classList.add('hidden');
    } else {
      this.mainView.classList.remove('active');
      this.settingsView.classList.add('active');
      this.settingsIcon.classList.add('hidden');
      this.backIcon.classList.remove('hidden');
      this.refreshSettingsView();
    }
  }

  private async refreshSettingsView() {
    const settings = await getSyncSettings();
    this.backendUrlInput.value = settings.backendUrl;
    this.marketPriceUrlInput.value = settings.marketPriceUrl || '';
    this.autoFillRowsCheckbox.checked = settings.autoFillRows;
    this.autoOpenModalCheckbox.checked = settings.autoOpenModal;

    // Check Backend
    this.setLoadingBadge(this.backendStatus, 'Checking...');
    const result = await testBackendConnection(settings.backendUrl);
    this.setBadge(this.backendStatus, result.message, result.success ? 'success' : 'error');

    // Check Dictionary
    try {
      const dict = await loadDictionary();
      this.dictVersion.textContent = `${Object.keys(dict.weapon_dict).length} Weapons / ${Object.keys(dict.attribute_dict).length} Attrs`;
      this.setBadge(this.dictStatus, 'Loaded', 'success');
    } catch (e) {
      this.setBadge(this.dictStatus, 'Failed', 'error');
    }
  }

  private setBadge(el: HTMLElement, text: string, type: 'success' | 'error' | 'info') {
    el.textContent = text;
    el.className = `status-badge ${type} inline-block`;
  }

  private setLoadingBadge(el: HTMLElement, text: string) {
    el.textContent = text;
    el.className = `status-badge info inline-block`;
  }

  private async handleTestConnection() {
    this.setLoadingBadge(this.backendStatus, 'Testing...');
    const result = await testBackendConnection(this.backendUrlInput.value);
    this.setBadge(this.backendStatus, result.message, result.success ? 'success' : 'error');
  }

  private async handleSaveBackend() {
    await setSyncSettings({ backendUrl: this.backendUrlInput.value });
    this.setBadge(this.backendStatus, 'Saved', 'success');
  }

  private async handleUpdateDict() {
    this.setBadge(this.dictStatus, 'Updating...', 'info');
    await chrome.storage.local.remove(['dictionary']);
    await this.refreshSettingsView();
  }

  private async handleSaveAllSettings() {
    await setSyncSettings({
      backendUrl: this.backendUrlInput.value,
      marketPriceUrl: this.marketPriceUrlInput.value,
      autoFillRows: this.autoFillRowsCheckbox.checked,
      autoOpenModal: this.autoOpenModalCheckbox.checked
    });
    
    // Dispatch a custom event to notify main.ts to show status
    const event = new CustomEvent('settings-saved', { detail: { message: 'Settings Applied' } });
    document.dispatchEvent(event);
    
    this.switchView('main');
  }
}
