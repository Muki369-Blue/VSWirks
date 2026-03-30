// Backward-compatible re-export from V2 modular structure.
// All consumers that require("../../shared/core") continue to work unchanged.
// New code should import directly from sub-modules: require("../../shared/core/defaults"), etc.
module.exports = require("./core/index");
