import re

def analyze_jsx(file_path):
    with open(file_path, 'r') as f:
        content = f.read()

    # Find the main return block
    start_idx = content.find('return (')
    if start_idx == -1:
        print("Could not find start of return block")
        return

    jsx_content = content[start_idx:]
    
    # Very simple stripping of expressions {} that might contain tags inside strings
    # This isn't perfect for JSX but helps avoid false positives in map() functions
    # Let's just find <tag> and </tag>
    
    tags = []
    # Match tags: <TagName>, </TagName>, <TagName ...>, <TagName ... />
    for m in re.finditer(r'<(/)?([A-Za-z0-9_.-]+)([^>]*?)(/?)>', jsx_content):
        is_closing = bool(m.group(1))
        tag_name = m.group(2)
        is_self_closing = bool(m.group(4))
        full_match = m.group(0)
        
        # We need to compute line number correctly. Let's do it via substring count
        line_num = content[:start_idx + m.start()].count('\n') + 1

        if is_self_closing or tag_name in ['br', 'hr', 'img', 'input', 'meta', 'link', 'path', 'circle']:
            continue
            
        # Ignore things that look like tags but are actually inside JS arrow functions like `a < b`
        if tag_name.islower() and tag_name not in ['div', 'span', 'p', 'h1', 'h2', 'h3', 'header', 'main', 'code', 'svg', 'button', 'a', 'label', 'select', 'option']:
            continue
            
        tags.append((tag_name, is_closing, line_num, full_match))

    stack = []
    for tag_name, is_closing, line_num, full in tags:
        if not is_closing:
            stack.append((tag_name, line_num, full))
        else:
            if not stack:
                print(f"Error: {tag_name} closing tag at line {line_num} has no matching open tag: {full}")
                continue
            
            top_name, top_line, top_full = stack[-1]
            if top_name == tag_name:
                stack.pop()
            else:
                print(f"Error: Mismatched tag at line {line_num}. Expected </{top_name}> (opened at line {top_line}: {top_full}), but found </{tag_name}>: {full}.")
                # look for it down the stack
                found = False
                for i in range(len(stack) - 1, -1, -1):
                    if stack[i][0] == tag_name:
                        print(f"  Recovered by popping {len(stack) - i} unclosed tags.")
                        stack = stack[:i]
                        found = True
                        break
                if not found:
                    print(f"  Could not recover. Ignoring closing tag.")

    print("\nSimulation complete. Remaining open tags at EOF:")
    for tag, line, full in stack:
        print(f"  <{tag}> opened at line {line}: {full}")


analyze_jsx('src/app/page.tsx')
