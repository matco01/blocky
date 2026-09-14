// react-native-qrcode-styled ships its declarations but omits the `types` field
// from its package.json, so TypeScript can't find them. Point at the real ones
// rather than declaring the module `any`.
declare module 'react-native-qrcode-styled' {
  export * from 'react-native-qrcode-styled/lib/typescript/commonjs/src';
  export { default } from 'react-native-qrcode-styled/lib/typescript/commonjs/src';
}
