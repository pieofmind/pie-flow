import { App, PluginSettingTab, Setting } from "obsidian";
import type DiagramsPlugin from "./main";
import { renderPomHeader } from "./pom-header";

export interface DiagramsSettings {
  defaultLayout: "LR" | "TB";
  validateBpmnBeforeExport: boolean;
  /** When false (default), plain JSON is stored — readable by AI agents and humans.
   *  When true, drawing data is Gzip+Base64 compressed (smaller files but opaque). */
  compressDrawingData: boolean;
  /** Folder where new `.omniboard.md` files are created when inserting a board
   *  into a note. Empty string → vault root. */
  boardFolder: string;
}

export const DEFAULT_SETTINGS: DiagramsSettings = {
  defaultLayout: "LR",
  validateBpmnBeforeExport: true,
  compressDrawingData: false,
  boardFolder: "Omniboards",
};

export class DiagramsSettingTab extends PluginSettingTab {
  plugin: DiagramsPlugin;

  constructor(app: App, plugin: DiagramsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    renderPomHeader(containerEl, "Pie Flow", "Vẽ sơ đồ BPMN & board trực quan ngay trong vault Obsidian");

    new Setting(containerEl)
      .setName("Default flow layout")
      .setDesc("Direction used when auto-laying out new flow-style diagrams.")
      .addDropdown((d) =>
        d
          .addOption("LR", "Left → Right")
          .addOption("TB", "Top → Bottom")
          .setValue(this.plugin.settings.defaultLayout)
          .onChange(async (v) => {
            this.plugin.settings.defaultLayout = v as "LR" | "TB";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Validate BPMN before export")
      .setDesc("Run semantic BPMN checks and block BPMN export when errors are present.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.validateBpmnBeforeExport)
          .onChange(async (v) => {
            this.plugin.settings.validateBpmnBeforeExport = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Compress drawing data (Gzip + Base64)")
      .setDesc(
        "When OFF (default): plain JSON is stored — AI agents and humans can read/write board files directly. " +
        "When ON: drawing data is compressed — smaller file size but unreadable by AI agents."
      )
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.compressDrawingData)
          .onChange(async (v) => {
            this.plugin.settings.compressDrawingData = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Board folder")
      .setDesc(
        "Folder where new board files (.omniboard.md) are created when you insert a board into a note. " +
        "Leave empty to create them at the vault root."
      )
      .addText((t) =>
        t
          .setPlaceholder("Omniboards")
          .setValue(this.plugin.settings.boardFolder)
          .onChange(async (v) => {
            this.plugin.settings.boardFolder = v.trim();
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("p", {
      text: "More settings (fonts, theme overrides, export defaults) arrive in later milestones.",
      cls: "setting-item-description",
    });
  }
}
