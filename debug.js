const fs = require('fs');
const path = require('path');

console.log('=== DEBUG: Checking Render File System ===');

// Check current directory
console.log('Current directory:', process.cwd());

// List all files in root
try {
  const files = fs.readdirSync('.');
  console.log('Files in root:', files);
} catch (err) {
  console.log('Error reading root:', err.message);
}

// Check if package.json exists
const packagePath = './package.json';
console.log('Looking for package.json at:', path.resolve(packagePath));
console.log('Package.json exists:', fs.existsSync(packagePath));

// Check Backend folder
try {
  const backendFiles = fs.readdirSync('./Backend');
  console.log('Files in Backend:', backendFiles);
} catch (err) {
  console.log('Error reading Backend:', err.message);
}
