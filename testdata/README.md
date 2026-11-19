# Test data

`golden/` holds expected output files. The worker (Python) and the web app (TypeScript)
both render `golden/m3u8-input.json` and must produce `golden/basic.m3u8` byte for byte.
