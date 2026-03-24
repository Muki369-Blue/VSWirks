"use strict";

const IPC_CHANNELS = Object.freeze([
  "vswirks:ready",
  "vswirks:refreshModels",
  "vswirks:startService",
  "vswirks:createProject",
  "vswirks:switchProject",
  "vswirks:setTargetPath",
  "vswirks:newChat",
  "vswirks:switchThread",
  "vswirks:deleteThread",
  "vswirks:updateThreadSettings",
  "vswirks:updateProjectSettings",
  "vswirks:attachFile",
  "vswirks:attachImage",
  "vswirks:attachEditorSelection",
  "vswirks:removeAttachment",
  "vswirks:buildSpec",
  "vswirks:refinePrompt",
  "vswirks:sendPrompt",
  "vswirks:resumeRun",
  "vswirks:replayRun",
  "vswirks:forkRunCheckpoint",
  "vswirks:uploadSpec",
  "vswirks:useMessageAsSpec",
  "vswirks:reviewGeneratedFiles",
  "vswirks:revealRunFiles",
  "vswirks:openRunDiff",
  "vswirks:abort",
  "vswirks:approveWrite",
  "vswirks:saveGenerationSettings",
  "vswirks:saveModelRoles",
  "vswirks:savePromptingSettings",
  "vswirks:getPromptPreview",
  "vswirks:resetGenerationSettings",
  "vswirks:openFile",
  "vswirks:openProjectInEditor",
  "vswirks:syncBridge"
]);

module.exports = {
  IPC_CHANNELS
};
