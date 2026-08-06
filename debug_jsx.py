import re

with open("src/app/page.tsx", "r") as f:
    code = f.read()

# Remove comments
code = re.sub(r'/\*[\s\S]*?\*/|//.*', '', code)

tags = []
for m in re.finditer(r'<(/)?([A-Za-z0-9_-]+)([^>]*?)(/?)>', code):
    is_closing = bool(m.group(1))
    tag_name = m.group(2)
    is_self_closing = bool(m.group(4))
    
    # ignore self closing and generic tags like <br/> <hr/> <img/> <input/>
    if is_self_closing or tag_name in ['br', 'hr', 'img', 'input', 'meta', 'link']:
        continue
        
    line_num = code.count('\n', 0, m.start()) + 1
    tags.append((tag_name, is_closing, line_num))

stack = []
for tag_name, is_closing, line_num in tags:
    if not is_closing:
        stack.append((tag_name, line_num))
    else:
        if not stack:
            print(f"Error: {tag_name} closing tag with no open tag at line {line_num}")
            break
        top_name, top_line = stack.pop()
        if top_name != tag_name:
            # We allow fragments <></> mapped to <Fragment></Fragment>. Just a basic check here.
            print(f"Error: Mismatched tag: expected </{top_name}> (opened at {top_line}), found </{tag_name}> at line {line_num}")
            # break # continue for more info
            
if stack:
    print(f"Unclosed tags at EOF:")
    for tag_name, line_num in stack[-5:]: # show last 5
        print(f"  <{tag_name}> from line {line_num}")
else:
    print("JSX Tags balanced perfectly.")
