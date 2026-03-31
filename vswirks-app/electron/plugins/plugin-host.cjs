// Phase 5: Plugin Host — connector registry and extensibility platform
// Manages plugin lifecycle, permissions, and the connector registry.

const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const PLUGINS_DIR = path.join(os.homedir(), "Library", "Application Support", "VSWirks", "plugins");
const REGISTRY_FILE = path.join(PLUGINS_DIR, "registry.json");

// Permission levels for plugin capabilities
const PERMISSIONS = Object.freeze({
  READ_WORKSPACE: "read-workspace",     // Read files in project workspace
  WRITE_WORKSPACE: "write-workspace",   // Write files in project workspace
  EXECUTE_COMMAND: "execute-command",    // Run shell commands
  NETWORK_ACCESS: "network-access",     // Make HTTP requests
  READ_STATE: "read-state",             // Read app state
  EMIT_EVENTS: "emit-events",           // Emit events to renderer
  MODEL_ACCESS: "model-access"          // Access LLM inference
});

class PluginHost {
  constructor({ emitEvent, getActiveProject } = {}) {
    this.emitEvent = emitEvent || (() => {});
    this.getActiveProject = getActiveProject || (() => null);
    this._plugins = new Map();     // pluginId -> { manifest, status, instance }
    this._connectors = new Map();  // connectorId -> { pluginId, type, config, handler }
  }

  // ── Plugin Lifecycle ────────────────────────────────

  /** Register a plugin from a manifest */
  async registerPlugin({ manifest } = {}) {
    if (!manifest || !manifest.id || !manifest.name) {
      return { ok: false, error: "Invalid plugin manifest: requires id and name" };
    }

    const plugin = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version || "0.0.0",
      description: manifest.description || "",
      author: manifest.author || "",
      permissions: Array.isArray(manifest.permissions) ? manifest.permissions : [],
      connectors: Array.isArray(manifest.connectors) ? manifest.connectors : [],
      entryPoint: manifest.entryPoint || "",
      status: "registered",
      registeredAt: Date.now(),
      instance: null
    };

    this._plugins.set(plugin.id, plugin);

    // Register connectors from this plugin
    for (const connector of plugin.connectors) {
      this._connectors.set(connector.id || `${plugin.id}:${connector.type}`, {
        pluginId: plugin.id,
        type: connector.type,      // types: model-provider, tool-provider, storage, webhook, ci-cd
        config: connector.config || {},
        handler: null,
        status: "registered"
      });
    }

    await this._saveRegistry();
    return { ok: true, pluginId: plugin.id };
  }

  /** Activate a registered plugin */
  async activatePlugin({ pluginId } = {}) {
    const plugin = this._plugins.get(pluginId);
    if (!plugin) return { ok: false, error: `Plugin not found: ${pluginId}` };
    if (plugin.status === "active") return { ok: true };

    // Verify permissions are acceptable
    const denied = plugin.permissions.filter((p) => !Object.values(PERMISSIONS).includes(p));
    if (denied.length) {
      return { ok: false, error: `Unknown permissions requested: ${denied.join(", ")}` };
    }

    plugin.status = "active";
    this.emitEvent({ type: "plugin-activated", pluginId });

    // Activate associated connectors
    for (const [connId, conn] of this._connectors) {
      if (conn.pluginId === pluginId) {
        conn.status = "active";
      }
    }

    await this._saveRegistry();
    return { ok: true };
  }

  /** Deactivate a plugin */
  async deactivatePlugin({ pluginId } = {}) {
    const plugin = this._plugins.get(pluginId);
    if (!plugin) return { ok: false, error: `Plugin not found: ${pluginId}` };

    plugin.status = "inactive";
    plugin.instance = null;

    // Deactivate associated connectors
    for (const [connId, conn] of this._connectors) {
      if (conn.pluginId === pluginId) {
        conn.status = "inactive";
        conn.handler = null;
      }
    }

    this.emitEvent({ type: "plugin-deactivated", pluginId });
    await this._saveRegistry();
    return { ok: true };
  }

  /** Unregister a plugin entirely */
  async unregisterPlugin({ pluginId } = {}) {
    await this.deactivatePlugin({ pluginId });
    this._plugins.delete(pluginId);

    // Remove associated connectors
    for (const [connId, conn] of this._connectors) {
      if (conn.pluginId === pluginId) {
        this._connectors.delete(connId);
      }
    }

    await this._saveRegistry();
    return { ok: true };
  }

  // ── Connector Registry ──────────────────────────────

  /** List all registered connectors */
  listConnectors({ type } = {}) {
    const result = [];
    for (const [id, conn] of this._connectors) {
      if (!type || conn.type === type) {
        result.push({ id, ...conn, handler: undefined });
      }
    }
    return result;
  }

  /** Get active connectors of a specific type */
  getActiveConnectors({ type } = {}) {
    return this.listConnectors({ type }).filter((c) => c.status === "active");
  }

  /** Register a connector handler (callback function) */
  setConnectorHandler({ connectorId, handler } = {}) {
    const conn = this._connectors.get(connectorId);
    if (!conn) return { ok: false, error: `Connector not found: ${connectorId}` };
    conn.handler = handler;
    return { ok: true };
  }

  /** Invoke a connector's handler */
  async invokeConnector({ connectorId, action, payload } = {}) {
    const conn = this._connectors.get(connectorId);
    if (!conn) return { ok: false, error: `Connector not found: ${connectorId}` };
    if (conn.status !== "active") return { ok: false, error: `Connector is not active: ${connectorId}` };
    if (!conn.handler) return { ok: false, error: `Connector has no handler: ${connectorId}` };

    // Check plugin permissions
    const plugin = this._plugins.get(conn.pluginId);
    if (!plugin || plugin.status !== "active") {
      return { ok: false, error: `Parent plugin is not active: ${conn.pluginId}` };
    }

    try {
      const result = await conn.handler({ action, payload, config: conn.config });
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: `Connector error: ${error.message}` };
    }
  }

  // ── Query ───────────────────────────────────────────

  /** List all plugins */
  listPlugins() {
    const result = [];
    for (const [id, plugin] of this._plugins) {
      result.push({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        author: plugin.author,
        permissions: plugin.permissions,
        status: plugin.status,
        connectorCount: plugin.connectors.length,
        registeredAt: plugin.registeredAt
      });
    }
    return result;
  }

  /** Get plugin details */
  getPlugin({ pluginId } = {}) {
    const plugin = this._plugins.get(pluginId);
    if (!plugin) return null;
    return {
      ...plugin,
      instance: undefined,
      connectors: plugin.connectors.map((c) => ({
        ...c,
        status: this._connectors.get(c.id || `${plugin.id}:${c.type}`)?.status || "unknown"
      }))
    };
  }

  // ── Persistence ─────────────────────────────────────

  async loadRegistry() {
    try {
      const raw = await fs.readFile(REGISTRY_FILE, "utf-8");
      const data = JSON.parse(raw);
      if (Array.isArray(data.plugins)) {
        for (const p of data.plugins) {
          this._plugins.set(p.id, { ...p, instance: null });
          for (const c of (p.connectors || [])) {
            this._connectors.set(c.id || `${p.id}:${c.type}`, {
              pluginId: p.id,
              type: c.type,
              config: c.config || {},
              handler: null,
              status: p.status === "active" ? "active" : "inactive"
            });
          }
        }
      }
    } catch {}
  }

  async _saveRegistry() {
    await fs.mkdir(PLUGINS_DIR, { recursive: true });
    const data = {
      version: 1,
      plugins: Array.from(this._plugins.values()).map((p) => ({
        id: p.id,
        name: p.name,
        version: p.version,
        description: p.description,
        author: p.author,
        permissions: p.permissions,
        connectors: p.connectors,
        entryPoint: p.entryPoint,
        status: p.status,
        registeredAt: p.registeredAt
      }))
    };
    const tmpPath = REGISTRY_FILE + `.tmp.${Date.now()}`;
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    await fs.rename(tmpPath, REGISTRY_FILE);
  }
}

module.exports = { PluginHost, PERMISSIONS };
