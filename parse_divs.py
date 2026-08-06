import re

with open("src/app/page.tsx", "r") as f:
    text = f.read()

# I will count ALL <div> and ALL </div> in the entire file.
open_divs = len(re.findall(r'<div\b[^>]*>', text))
close_divs = len(re.findall(r'</div>', text))

print(f"Total open divs: {open_divs}, Total close divs: {close_divs}")
