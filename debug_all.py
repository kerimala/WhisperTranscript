import re

with open("src/app/page.tsx", "r") as f:
    text = f.read()

# Remove JSX comments
text = re.sub(r'{\s*/\*(.*?)\*/\s*}', '', text, flags=re.DOTALL)
text = re.sub(r'//(.*)', '', text)

# Find all opening and closing tags in JSX
# Exclude self-closing and empty elements < />
tags = re.findall(r'<(/?[A-Za-z0-9]+)[^>]*?(?<!/)>', text)

stack = []
for index, tag in enumerate(tags):
    name = tag.replace('/', '')
    if name in ['br', 'hr', 'img', 'input', 'path', 'circle', 'svg', 'a']: # svg/a can be nested but keeping it simple
        continue
        
    if not tag.startswith('/'):
        stack.append(name)
    else:
        if not stack:
            print(f"Error at index {index}: Unmatched closing tag </{name}>")
            continue
        
        top = stack.pop()
        if top != name:
            print(f"Error at index {index}: Mismatched tags. Expected </{top}>, found </{name}>.")
            # Assume `top` was unclosed, keep checking
            
print(f"Tags remaining open at EOF: {stack}")
