"""Builds index.html from src/: the logo glyphs, the page template and the WebGL engine.

    python3 build.py
"""
import json, pathlib
root = pathlib.Path(__file__).parent
src = root / 'src'
d = json.loads((src / 'glyphs.json').read_text())
P, B = d['paths'], d['bbox']
order = ['M', 'e1', 'd', 'o', 'n', 'g', 'a', 'u', 'l', 'e2']
letters = ''.join(f'<path id="L_{k}" data-cx="{(B[k][0]+B[k][2])/2:.1f}" d="{P[k]}"/>' for k in order)
leaves = ''.join(f'<path id="F_{k}" d="{P[k]}"/>' for k in ['leaf1', 'leaf2'])
svg = ('<svg viewBox="185 218 1000 212" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Médongaule">'
       '<defs><clipPath id="soil"><rect x="120" y="150" width="1130" height="281.5"/></clipPath></defs>'
       f'<g clip-path="url(#soil)" fill="#BDBD89" fill-rule="evenodd">{letters}</g>'
       f'<g fill="#BDBD89" fill-rule="evenodd">{leaves}</g></svg>')
body = ((src / 'template.html').read_text()
        .replace('%%LOGO_SVG%%', svg)
        .replace('%%ENGINE%%', (src / 'engine.js').read_text()))
html = ('<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<meta name="description" content="메덩골정원 3D 웹 경험">\n'
        '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>\n'
        + body.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '') +
        '\n</html>\n')
(root / 'index.html').write_text(html)
print('index.html', len(html) // 1024, 'KB')
