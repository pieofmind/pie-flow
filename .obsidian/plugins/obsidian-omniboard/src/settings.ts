import { App, PluginSettingTab, Setting } from "obsidian";
import type DiagramsPlugin from "./main";

export interface DiagramsSettings {
  defaultLayout: "LR" | "TB";
}

export const DEFAULT_SETTINGS: DiagramsSettings = {
  defaultLayout: "LR",
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
    containerEl.createEl("h2", { text: "Diagrams" });

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

    containerEl.createEl("p", {
      text: "More settings (fonts, theme overrides, export defaults) arrive in later milestones.",
      cls: "setting-item-description",
    });
  }
}
