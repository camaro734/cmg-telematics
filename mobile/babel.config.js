module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // IMPORTANT: react-native-reanimated/plugin must always be last
      'react-native-reanimated/plugin',
    ],
  };
};
