const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { PluginHost, PERMISSIONS } = require("../electron/plugins/plugin-host.cjs");

describe("PluginHost", () => {
  it("PERMISSIONS has 7 capability levels", () => {
    assert.equal(Object.keys(PERMISSIONS).length, 7);
    assert.equal(PERMISSIONS.READ_WORKSPACE, "read-workspace");
    assert.equal(PERMISSIONS.MODEL_ACCESS, "model-access");
  });

  it("registerPlugin rejects invalid manifest", async () => {
    const host = new PluginHost();
    const r1 = await host.registerPlugin({});
    assert.equal(r1.ok, false);
    const r2 = await host.registerPlugin({ manifest: { id: "x" } });
    assert.equal(r2.ok, false);
  });

  it("registerPlugin and listPlugins round-trip", async () => {
    const host = new PluginHost();
    const result = await host.registerPlugin({
      manifest: {
        id: "test-plugin",
        name: "Test Plugin",
        version: "1.0.0",
        permissions: ["read-workspace"],
        connectors: [{ type: "tool-provider", config: { tool: "lint" } }]
      }
    });
    assert.equal(result.ok, true);
    assert.equal(result.pluginId, "test-plugin");

    const plugins = host.listPlugins();
    assert.equal(plugins.length, 1);
    assert.equal(plugins[0].name, "Test Plugin");
    assert.equal(plugins[0].status, "registered");
  });

  it("activatePlugin transitions status and activates connectors", async () => {
    const events = [];
    const host = new PluginHost({ emitEvent: (e) => events.push(e) });
    await host.registerPlugin({
      manifest: { id: "p1", name: "P1", permissions: ["read-workspace"], connectors: [{ type: "tool-provider" }] }
    });

    const result = await host.activatePlugin({ pluginId: "p1" });
    assert.equal(result.ok, true);

    const plugins = host.listPlugins();
    assert.equal(plugins[0].status, "active");
    assert.ok(events.some((e) => e.type === "plugin-activated"));

    const connectors = host.getActiveConnectors({ type: "tool-provider" });
    assert.equal(connectors.length, 1);
  });

  it("activatePlugin rejects unknown permissions", async () => {
    const host = new PluginHost();
    await host.registerPlugin({
      manifest: { id: "p2", name: "P2", permissions: ["unknown-perm"] }
    });
    const result = await host.activatePlugin({ pluginId: "p2" });
    assert.equal(result.ok, false);
    assert.match(result.error, /Unknown permissions/);
  });

  it("deactivatePlugin transitions to inactive", async () => {
    const host = new PluginHost();
    await host.registerPlugin({ manifest: { id: "p3", name: "P3" } });
    await host.activatePlugin({ pluginId: "p3" });
    const result = await host.deactivatePlugin({ pluginId: "p3" });
    assert.equal(result.ok, true);

    const plugins = host.listPlugins();
    assert.equal(plugins[0].status, "inactive");
  });

  it("unregisterPlugin removes plugin and connectors", async () => {
    const host = new PluginHost();
    await host.registerPlugin({
      manifest: { id: "p4", name: "P4", connectors: [{ type: "storage" }] }
    });
    assert.equal(host.listPlugins().length, 1);
    assert.equal(host.listConnectors().length, 1);

    await host.unregisterPlugin({ pluginId: "p4" });
    assert.equal(host.listPlugins().length, 0);
    assert.equal(host.listConnectors().length, 0);
  });

  it("invokeConnector calls handler and returns result", async () => {
    const host = new PluginHost();
    await host.registerPlugin({
      manifest: { id: "p5", name: "P5", connectors: [{ id: "c1", type: "tool-provider" }] }
    });
    await host.activatePlugin({ pluginId: "p5" });

    host.setConnectorHandler({
      connectorId: "c1",
      handler: async ({ action, payload }) => ({ echo: action, data: payload })
    });

    const result = await host.invokeConnector({ connectorId: "c1", action: "lint", payload: { file: "app.js" } });
    assert.equal(result.ok, true);
    assert.equal(result.result.echo, "lint");
    assert.equal(result.result.data.file, "app.js");
  });

  it("invokeConnector fails for inactive connector", async () => {
    const host = new PluginHost();
    await host.registerPlugin({
      manifest: { id: "p6", name: "P6", connectors: [{ id: "c2", type: "webhook" }] }
    });
    // Not activated
    const result = await host.invokeConnector({ connectorId: "c2", action: "fire" });
    assert.equal(result.ok, false);
    assert.match(result.error, /not active/);
  });

  it("getPlugin returns enriched plugin details", async () => {
    const host = new PluginHost();
    await host.registerPlugin({
      manifest: { id: "p7", name: "P7", description: "Test", connectors: [{ type: "ci-cd" }] }
    });
    const details = host.getPlugin({ pluginId: "p7" });
    assert.equal(details.id, "p7");
    assert.equal(details.description, "Test");
    assert.ok(Array.isArray(details.connectors));
  });

  it("getPlugin returns null for unknown plugin", () => {
    const host = new PluginHost();
    assert.equal(host.getPlugin({ pluginId: "nope" }), null);
  });
});
