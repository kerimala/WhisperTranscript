const fs = require('fs');

let code = fs.readFileSync('src/app/page.tsx', 'utf8');

// Simplistic tag extractor
const tags = [...code.matchAll(/<\/?([A-Za-z]+)[^>]*?>/g)].map(m => m[0]);
let open = 0;
let errors = [];
let stack = [];

for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t.startsWith('</')) {
        let name = t.replace('</', '').replace('>', '').trim();
        let top = stack.pop();
        if (top !== name && !(top === undefined)) {
            errors.push(`Mismatched: expected </${top}>, found </${name}>`);
        }
    } else if (!t.endsWith('/>')) {
        let name = t.split(' ')[0].replace('<', '').replace('>', '').trim();
        // Ignore known self-closing
        if (!['br','hr','img','input','meta','link','path','svg'].includes(name)) {
            stack.push(name);
        }
    }
}
console.log(`Unclosed tags: ${stack.join(', ')}`);
console.log(`Errors: ${errors.slice(0, 5).join(' | ')}`);
