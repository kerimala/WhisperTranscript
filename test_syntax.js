const fs = require('fs');

const code = fs.readFileSync('src/app/page.tsx', 'utf8');
const { parse } = require('@babel/parser');

try {
  parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript']
  });
  console.log("Babel parse successful");
} catch (err) {
  console.log("Babel parse failed:", err.message);
  console.log("Line:", err.loc?.line, "Column:", err.loc?.column);
}
