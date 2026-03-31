// @domain: settings — Generation settings, model roles, prompting settings mixin
// Applied to the controller prototype in controller.cjs

const { writeSettings } = require("../../../shared/vswirks-state");
const {
  normalizeGenerationSettings,
  DEFAULT_GENERATION_SETTINGS
} = require("../../../shared/core");
const { normalizeModelRoles } = require("./model-roles.cjs");

module.exports = {
  async saveGenerationSettings({ settings } = {}) {
    this.settings.generationSettings = normalizeGenerationSettings(settings);
    await writeSettings(this.settings);
    this.postState();
    return { ok: true };
  },

  async saveModelRoles({ modelRoles } = {}) {
    this.settings.modelRoles = normalizeModelRoles(modelRoles, this.models);
    await writeSettings(this.settings);
    this.postState();
    return { ok: true };
  },

  async resetGenerationSettings() {
    this.settings.generationSettings = { ...DEFAULT_GENERATION_SETTINGS };
    await writeSettings(this.settings);
    this.postState();
    return { ok: true };
  }
};
