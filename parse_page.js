const fs = require('fs');
let code = fs.readFileSync('src/app/page.tsx', 'utf8');

let startIndex = code.indexOf('return (');
if (startIndex === -1) {
    console.log("Could not find start of return statement.");
    process.exit(1);
}

let jsxFragment = code.substring(startIndex + 'return ('.length);

let openCount = 0;
let closeCount = 0;

for (let i = 0; i < jsxFragment.length; i++) {
   if (jsxFragment[i] === '<') {
       if (jsxFragment[i+1] === '/') {
           closeCount++;
       } else if (jsxFragment[i+1] !== '!' && jsxFragment[i+1] !== '?') {
            // Very naive check to ignore closing tags of self-closing elements.
            openCount++;
       }
   }
}

console.log(`Open: ${openCount}, Close: ${closeCount}`);
