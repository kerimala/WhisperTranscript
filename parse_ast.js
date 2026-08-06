const fs = require('fs');

const code = fs.readFileSync('src/app/page.tsx', 'utf8');

// Use a simple scanner based on index tracking to find mismatched tags in the return block
const startIdx = code.indexOf('return (');
if (startIdx === -1) {
    console.log("Could not find start of return statement.");
    process.exit(1);
}

const jsxContent = code.substring(startIdx + 'return ('.length);

let i = 0;
const stack = [];

while (i < jsxContent.length) {
    // Skip JSX expressions {} that might contain strings or array maps
    if (jsxContent[i] === '{') {
        let braceCount = 1;
        i++;
        while (i < jsxContent.length && braceCount > 0) {
            if (jsxContent[i] === '{') braceCount++;
            if (jsxContent[i] === '}') braceCount--;
            i++;
        }
        continue;
    }

    // Skip comments
    if (jsxContent.substring(i, i + 4) === '<!--') {
        i = jsxContent.indexOf('-->', i) + 3;
        continue;
    }

    // Process tags
    if (jsxContent[i] === '<') {
        const isClosing = jsxContent[i + 1] === '/';
        const tagStart = isClosing ? i + 2 : i + 1;
        
        let tagEnd = tagStart;
        while (tagEnd < jsxContent.length && /[a-zA-Z0-9_-]/.test(jsxContent[tagEnd])) {
            tagEnd++;
        }
        
        const tagName = jsxContent.substring(tagStart, tagEnd);
        
        if (tagName && /^[a-zA-Z]/.test(tagName) && !['br', 'hr', 'img', 'input', 'meta', 'link', 'path', 'circle', 'svg', 'a'].includes(tagName)) {
            // Find end of tag >
            let bracketEnd = jsxContent.indexOf('>', tagEnd);
            if (bracketEnd !== -1) {
                const fullTag = jsxContent.substring(i, bracketEnd + 1);
                const isSelfClosing = jsxContent[bracketEnd - 1] === '/';
                const lineNum = code.substring(0, startIdx + i).split('\n').length;
                
                if (!isSelfClosing) {
                    if (!isClosing) {
                        stack.push({name: tagName, line: lineNum, text: fullTag});
                    } else {
                        if (stack.length === 0) {
                            console.log(`Error: unmatched closing tag ${fullTag} at line ${lineNum}`);
                        } else {
                            const top = stack.pop();
                            if (top.name !== tagName) {
                                console.log(`Error: Mismatched tag at line ${lineNum}. Expected </${top.name}> (opened at ${top.line}), found ${fullTag}`);
                                // recover
                                for (let j = stack.length - 1; j >= 0; j--) {
                                    if (stack[j].name === tagName) {
                                        stack.length = j; // Pop everything above it
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
                i = bracketEnd;
            }
        }
    }
    i++;
}

console.log("\nFinished. Unclosed tags remaining:");
for (const item of stack) {
    console.log(`  <${item.name}> from line ${item.line} : ${item.text}`);
}
