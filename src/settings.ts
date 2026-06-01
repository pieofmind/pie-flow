import { App, PluginSettingTab, Setting } from "obsidian";
import type DiagramsPlugin from "./main";

export interface DiagramsSettings {
  defaultLayout: "LR" | "TB";
  validateBpmnBeforeExport: boolean;
<<<<<<< HEAD
  /** When true (default), drawing data is Gzip+Base64 compressed.
   *  When false, plain JSON is stored — readable by AI agents and humans. */
=======
>>>>>>> 59490c1 (Stabilize edge endpoint finalization to stop off-center BPMN snaps)
  compressDrawingData: boolean;
}

export const DEFAULT_SETTINGS: DiagramsSettings = {
  defaultLayout: "LR",
  validateBpmnBeforeExport: true,
  compressDrawingData: true,
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
<<<<<<< HEAD
      .setName("Compress drawing data (Gzip + Base64)")
      .setDesc(
        "When ON (default): drawing data is compressed — smaller file size but unreadable by AI agents. " +
        "When OFF: plain JSON is stored — AI agents can read and write board files directly."
      )
=======
      .setName("Compress drawing data")
      .setDesc("Use Gzip + Base64 for drawing/source-meta blocks. Turn off to store raw JSON for easier AI/agent editing.")
>>>>>>> 59490c1 (Stabilize edge endpoint finalization to stop off-center BPMN snaps)
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.compressDrawingData)
          .onChange(async (v) => {
            this.plugin.settings.compressDrawingData = v;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("p", {
      text: "More settings (fonts, theme overrides, export defaults) arrive in later milestones.",
      cls: "setting-item-description",
    });
  }
}
