// Metro config para Expo SDK 54 + Expo Router
// getDefaultConfig carga automáticamente los paths de tsconfig.json (@/ alias)
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

module.exports = config;
