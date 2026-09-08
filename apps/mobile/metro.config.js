// Metro, taught to see the monorepo.
//
// Without this the app resolves @blocky/shared to nothing, because Metro only
// walks up from the project root by default and our packages live a level up.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Resolve strictly from the paths above, so a stray nested copy of React can't
// be picked up and produce two-Reacts errors that take a day to diagnose.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
