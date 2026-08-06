import re

with open("src/app/page.tsx", "r") as f:
    text = f.read()

# React allows raw text or map functions. Let's look for map loops.
maps = re.findall(r'\.map\([^=>]+=>\s*\((.*?)\)\)', text, re.DOTALL)
print(f"Found {len(maps)} map loops")

