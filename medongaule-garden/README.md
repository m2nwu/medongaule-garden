# Médongaule 정원 여정

메덩골정원 로고 모션으로 시작해, 글자 속으로 뛰어들어 3D로 재구성한 정원을 스크롤로 거니는 웹 경험입니다.
외부 라이브러리 없이 WebGL2로 직접 그립니다.

## 구성

| 경로 | 내용 |
|---|---|
| `index.html` | 완성된 웹페이지 (이 파일 하나만 있으면 동작) |
| `src/engine.js` | 3D 엔진: 지형, 건물, 숲, 계절, 카메라 경로 |
| `src/template.html` | 화면 구성: 로고 인트로, 글자 포털, 계절 버튼 |
| `src/glyphs.json` | 로고 이미지에서 추출한 글자 벡터 |
| `build.py` | `src/`를 합쳐 `index.html`을 만드는 스크립트 |
| `assets/` | 로고 원본 이미지, 로고 모션 영상 (MP4) |

## 로컬에서 보기

`index.html`을 브라우저로 열면 됩니다.

## 수정 후 다시 만들기

`src/` 안의 파일을 고친 뒤 실행합니다.

```bash
python3 build.py
```

## GitHub Pages로 공개하기

1. 이 폴더를 GitHub 저장소에 올립니다.
2. 저장소의 **Settings → Pages**에서 **Source**를 `Deploy from a branch`, **Branch**를 `main` / `/ (root)`로 정하고 저장합니다.
3. 1–2분 뒤 `https://<계정명>.github.io/<저장소명>/` 에서 열립니다.

## 시설 수정 방법

`src/engine.js`의 `STATIONS` 목록에 각 시설의 위치와 반경이 있고, `BUILD` 객체에 시설별 형태 함수가 있습니다.
카메라가 들르는 장면은 `KEYS` 목록(스크롤 위치, 카메라 위치, 바라보는 지점)으로 정합니다.
