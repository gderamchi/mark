const { withDangerousMod, withXcodeProject, IOSConfig } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const SOURCE_DIR = path.resolve(__dirname, "..", "native", "VoiceIO");
const FILES = ["VoiceIOModule.swift", "VoiceIOModule.m"];

function withVoiceIOFiles(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const projectName = cfg.modRequest.projectName;
      const targetDir = path.join(cfg.modRequest.platformProjectRoot, projectName);

      for (const file of FILES) {
        const src = path.join(SOURCE_DIR, file);
        const dest = path.join(targetDir, file);
        fs.copyFileSync(src, dest);
      }

      return cfg;
    },
  ]);
}

function withVoiceIOXcodeProject(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const projectName = cfg.modRequest.projectName;
    const groupPath = projectName;

    for (const file of FILES) {
      const filePath = path.join(groupPath, file);

      if (project.hasFile(filePath)) continue;

      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: filePath,
        groupName: projectName,
        project,
      });
    }

    return cfg;
  });
}

function withVoiceIO(config) {
  config = withVoiceIOFiles(config);
  config = withVoiceIOXcodeProject(config);
  return config;
}

module.exports = withVoiceIO;
