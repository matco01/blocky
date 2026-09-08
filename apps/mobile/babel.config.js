module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Must stay last: Reanimated's worklet transform has to run after everything else.
    plugins: ['react-native-worklets/plugin'],
  };
};
