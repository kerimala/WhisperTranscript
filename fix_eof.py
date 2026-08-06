import re

with open("src/app/page.tsx", "r") as f:
    text = f.read()

# Let's find exactly where the bottom part is
idx = text.rfind("</main")
if idx != -1:
    new_text = text[:idx] + "</main>\n  );\n}\n"
    with open("src/app/page.tsx", "w") as f:
        f.write(new_text)
    print(f"Truncated and replaced right at index {idx}")
else:
    print("Could not find </main>")
