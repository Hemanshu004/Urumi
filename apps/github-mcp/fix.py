import re
content = open("src/index.ts").read()
content = content.replace(
    'new Request("http://localhost/mcp", {',
    'new Request("http://localhost" + (req.url === "/" ? "/sse" : req.url), {'
)
open("src/index.ts", "w").write(content)
