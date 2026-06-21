const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Inyecta flags de compilación en el post_install del Podfile para evitar el
// error "'folly/coro/Coroutine.h' file not found" en Xcode 16.4+ / RN 0.81.
// El toolchain detecta soporte de corrutinas y activa FOLLY_HAS_COROUTINES,
// pero RCT-Folly no incluye esa cabecera. Forzamos su desactivación.
// También aplicamos -DFMT_USE_CONSTEVAL=0 (mismo flag que usa Codemagic).
const MARKER = '# withFollyNoCoroutines';
const INJECTION = `
    ${MARKER}: desactivar folly coroutines + FMT_USE_CONSTEVAL
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |bc|
        bc.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= ['$(inherited)']
        bc.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] += ['FOLLY_CFG_NO_COROUTINES=1', 'FOLLY_HAS_COROUTINES=0']
        bc.build_settings['OTHER_CFLAGS'] = '$(inherited) -DFMT_USE_CONSTEVAL=0 -DFOLLY_CFG_NO_COROUTINES=1 -DFOLLY_HAS_COROUTINES=0'
        bc.build_settings['OTHER_CPLUSPLUSFLAGS'] = '$(inherited) -DFMT_USE_CONSTEVAL=0 -DFOLLY_CFG_NO_COROUTINES=1 -DFOLLY_HAS_COROUTINES=0'
      end
    end
`;

module.exports = function withFollyNoCoroutines(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');
      if (!contents.includes(MARKER)) {
        contents = contents.replace(
          /(post_install do \|installer\|\n)/,
          `$1${INJECTION}`
        );
        fs.writeFileSync(podfilePath, contents);
      }
      return cfg;
    },
  ]);
};
