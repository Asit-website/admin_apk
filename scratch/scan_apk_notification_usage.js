const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');

function scanDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      scanDir(fullPath);
    } else if (file.endsWith('.js') || file.endsWith('.jsx')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('AndroidNotification') || content.includes('notify') || content.includes('setNotificationRef')) {
        console.log(`Found reference in file: ${path.relative(srcDir, fullPath)}`);
      }
    }
  }
}

scanDir(srcDir);
