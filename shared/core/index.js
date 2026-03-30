// V2 modular re-export — all public API surfaces from core sub-modules.
// Consumers can import from "shared/core" (via ../core.js) or directly
// from sub-modules (e.g. "shared/core/defaults") for narrower coupling.

const defaults = require("./defaults");
const utils = require("./utils");
const factories = require("./factories");
const presets = require("./presets");
const normalization = require("./normalization");

module.exports = {
  // defaults
  ...defaults,
  // utils
  ...utils,
  // factories
  ...factories,
  // presets
  ...presets,
  // normalization (includes createProjectSession)
  ...normalization
};
