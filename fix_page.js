const fs = require('fs');

let code = fs.readFileSync('src/app/page.tsx', 'utf8');

// The issue might be missing JSX curlies or similar near the end. Let's find exactly what it thinks is an unterminated regex. 
// A very common reason is `</main >` being parsed weirdly or a missing brace `{` before a state/map expression causing `<` to be parsed as less than instead of JSX tag.

const lines = code.split('\n');
const tail = lines.slice(lines.length - 30);
console.log(tail.join('\n'));
