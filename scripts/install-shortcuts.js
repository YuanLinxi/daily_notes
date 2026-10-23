// 在桌面创建启动快捷方式，并在用户登录时静默驻留托盘
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const root = path.join(__dirname, '..');
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const icon = path.join(root, 'assets', 'icon.ico');

if (!fs.existsSync(electron)) {
  console.error('未找到 Electron 程序，请先运行 npm install。');
  process.exit(1);
}

const desktop = path.join(os.homedir(), 'Desktop');
const startup = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');

const psString = (s) => `'${s.replace(/'/g, "''")}'`;

function makeShortcut(lnkPath, args) {
  const script = `
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut(${psString(lnkPath)})
$s.TargetPath = ${psString(electron)}
$s.Arguments = ${psString(args)}
$s.WorkingDirectory = ${psString(root)}
$s.IconLocation = ${psString(icon + ',0')}
$s.Description = 'Daily Notes - 单机笔记'
$s.Save()
`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'inherit' });
}

makeShortcut(path.join(desktop, 'Daily Notes.lnk'), `"${root}"`);
makeShortcut(path.join(startup, 'Daily Notes.lnk'), `"${root}" --hidden`);
console.log('桌面快捷方式：', path.join(desktop, 'Daily Notes.lnk'));
console.log('开机自启（托盘）：', path.join(startup, 'Daily Notes.lnk'));
