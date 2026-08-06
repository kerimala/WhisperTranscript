import sys

def check_brackets(file_path):
    with open(file_path, 'r') as f:
        content = f.read()

    stack = []
    pairs = {'{': '}', '[': ']', '(': ')', '<': '>'}
    reverse_pairs = {v: k for k, v in pairs.items()}
    lines = content.split('\n')
    
    # Very basic check, ignoring strings/comments for a quick test
    for line_num, line in enumerate(lines, 1):
        for col_num, char in enumerate(line, 1):
            if char in pairs:
                stack.append((char, line_num, col_num))
            elif char in reverse_pairs:
                if not stack:
                    print(f"Error: Unmatched closing bracket '{char}' at line {line_num}, col {col_num}")
                    return False
                top_char, top_line, top_col = stack.pop()
                if top_char != reverse_pairs[char]:
                    print(f"Error: Mismatched brackets: expected '{pairs[top_char]}' for '{top_char}' at ({top_line}, {top_col}), but found '{char}' at line {line_num}, col {col_num}")
                    return False
    
    if stack:
        for char, line, col in stack:
            print(f"Error: Unclosed bracket '{char}' found at line {line}, col {col}")
        return False
        
    print("All brackets match (simple check).")
    return True

check_brackets('src/app/page.tsx')
