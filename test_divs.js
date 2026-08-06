const fs = require('fs');

let code = fs.readFileSync('src/app/page.tsx', 'utf8');

// The issue might be missing JSX curlies or similar near the end. Let's find exactly what it thinks is an unterminated regex. 
// A very common reason is `</main >` being parsed weirdly or a missing brace `{` before a state/map expression causing `<` to be parsed as less than instead of JSX tag.

const lines = code.split('\n');
let openCount = 0;
let closeCount = 0;
for (let i = 0; i < lines.length; i++) {
  openCount += (lines[i].match(/<div/g) || []).length;
  closeCount += (lines[i].match(/<\/div>/g) || []).length;
  if (openCount !== closeCount) {
    // console.log(`Line ${i + 1}: open=${openCount}, close=${closeCount}`);
  }
}
console.log(`Open divs: ${openCount}, Close divs: ${closeCount}`);
