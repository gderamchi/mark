const path = require("path");
const { getDefaultConfig } = require("@expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...new Set([...(config.watchFolders ?? []), workspaceRoot])];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules")
];

// Force single copies of shared singletons across the monorepo
config.resolver.extraNodeModules = {
  react: path.resolve(workspaceRoot, "node_modules/react"),
  "react-native": path.resolve(workspaceRoot, "node_modules/react-native"),
  "react-native-gesture-handler": path.resolve(workspaceRoot, "node_modules/react-native-gesture-handler"),
  "react-native-reanimated": path.resolve(workspaceRoot, "node_modules/react-native-reanimated"),
  "react-native-worklets": path.resolve(workspaceRoot, "node_modules/react-native-worklets"),
  "expo-blur": path.resolve(workspaceRoot, "node_modules/expo-blur"),
  "expo-linear-gradient": path.resolve(workspaceRoot, "node_modules/expo-linear-gradient"),
  "expo-haptics": path.resolve(workspaceRoot, "node_modules/expo-haptics"),
};

module.exports = config;
