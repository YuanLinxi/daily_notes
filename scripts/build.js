// 一键打包：生成 Windows 安装包（release/Daily Notes-<版本>-Setup.exe）
// 用法：npm run build        生成安装包
//       npm run pack         只生成免安装目录（release/win-unpacked）
const path = require('path');
const fs = require('fs');
const { build } = require('electron-builder');

const root = path.join(__dirname, '..');
const dirOnly = process.argv.includes('--dir');

// 国内网络走镜像，避免下载 Electron / NSIS 工具链超时
process.env.ELECTRON_MIRROR ||= 'https://npmmirror.com/mirrors/electron/';
process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||= 'https://npmmirror.com/mirrors/electron-builder-binaries/';

(async () => {
  if (!fs.existsSync(path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'))) {
    console.error('未找到 Electron 运行环境，请先执行：npm install');
    process.exit(1);
  }
  const pkg = require(path.join(root, 'package.json'));
  console.log(`开始打包 Daily Notes v${pkg.version}${dirOnly ? '（免安装目录）' : '（安装包）'}…`);

  let artifacts = await build({
    projectDir: root,
    config: dirOnly
      ? { win: { target: 'dir' } }
      : undefined,
  }).catch((err) => {
    console.error('\n打包失败：', err.message);
    process.exit(1);
  });

  if (!artifacts.length) {
    const outDir = path.join(root, 'release');
    artifacts = (fs.existsSync(outDir) ? fs.readdirSync(outDir) : [])
      .filter((f) => f.endsWith('.exe'))
      .map((f) => path.join(outDir, f));
    if (dirOnly) artifacts.push(path.join(root, 'release', 'win-unpacked'));
  }
  console.log('\n打包完成，产物：');
  for (const f of artifacts) {
    const size = fs.statSync(f).size / 1024 / 1024;
    console.log(`  ${path.relative(root, f)}  (${size.toFixed(1)} MB)`);
  }
})();
