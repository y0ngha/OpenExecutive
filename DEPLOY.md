# Hoiv Executive 배포 가이드 (Oracle Cloud Always Free)

이 브랜치(`deploy/oracle`)는 Open Executive에 한국어 UI(`feat/korean-ui`)와 이 배포 구성을 더한 것입니다. 앱 이름은 **Hoiv Executive**로 표시됩니다. 이 문서는 서버 생성부터 운영까지 전 과정을 정리합니다. 콘솔 화면 기준의 상세한 단계는 [`deploy/oracle/README.md`](deploy/oracle/README.md)에 있습니다.

> 저장소가 공개되어 있으므로 실제 도메인, IP, 이메일, 키는 이 문서와 커밋에 넣지 않습니다. 아래의 `app.example.com`, `<서버IP>` 같은 값은 자리표시자입니다. 비밀값은 저장소 밖(예: `~/Desktop/oe`)과 서버의 gitignore된 파일에만 둡니다.

---

## 1. 구성

```
브라우저 / Slack / MCP 클라이언트
   │ HTTPS (80/443만 공개)
   ▼
Caddy ── 인증서 자동 발급·갱신, robots/noindex, (선택) MCP 비밀 경로
   ├─▶ UI  (Next.js, 내부 3000) ── 로그인(Google) 후 /api/backend/* 로 API 프록시
   └─▶ API (FastAPI, 내부 8000) ── /data 볼륨: SQLite, Chroma, 회사 자료, 토큰
        └─ Slack은 Socket Mode: 서버가 Slack에 먼저 연결 (웹훅·공개 주소 불필요)
```

- 컨테이너 3개(`deploy/oracle/docker-compose.yml`). 외부에 열리는 건 Caddy뿐이고, API와 UI는 내부 네트워크에만 있습니다.
- **API는 반드시 1개**만 띄웁니다. 두 개면 예약 작업(브리핑, 알림)이 두 번씩 실행됩니다.
- 공개 배포 설정이 강제됩니다(`OE_PUBLIC_DEPLOYMENT=1`, 로컬 로그인 끔). 처음 접속부터 Google 로그인이 필요합니다.

| 파일 | 역할 |
|---|---|
| `deploy/oracle/oci-provision.sh` | OCI CLI로 네트워크·고정 IP·A1 인스턴스 생성 (자리 없을 때 자동 재시도) |
| `deploy/oracle/setup-server.sh` | 새 Ubuntu 서버 준비: Docker, 방화벽 80/443, 스왑 4GB, 로그 제한 |
| `deploy/oracle/init-env.sh` | 설정 파일 3개를 대화형으로 생성 (비밀값 자동 생성) |
| `deploy/oracle/env-from-yaml.py` | 같은 일을 비밀값 YAML 하나로 (예: `secrets.example.yaml`) |
| `deploy/oracle/oe.sh` | 운영 명령: `up`, `load`, `update`, `status`, `logs`, `backup`, `mcp-on` … |
| `deploy/oracle/slack-manifest.yaml` | Slack 앱 매니페스트 |

---

## 2. Oracle 무료 티어에서 알아둘 것

| 항목 | 내용 |
|---|---|
| A1 (ARM) 무료 한도 | **2 OCPU / 12GB** (2026년 6월에 4/24에서 축소). 계정 전체 합계 |
| 디스크 | 부트 + 블록 합계 200GB (이 구성은 100GB 사용) |
| AMD Micro (1GB) | 이 앱(API만 2GB 필요)에는 부족해서 쓸 수 없음 |
| 홈 리전 | 무료 인스턴스는 홈 리전에서만. 가입 후 변경 불가 |
| A1 자리 부족 | "Out of host capacity"가 흔함. 재시도로 해결 (`oci-provision.sh`가 자동) |
| 유휴 회수 | 7일간 CPU·네트워크·메모리 사용률이 모두 20% 미만이면 무료 계정 인스턴스가 회수될 수 있음 |
| PAYG 업그레이드 | 회수 방지 + 자리 잡기 쉬움. 무료 한도 안이면 0원. 승인까지 몇 시간~며칠 |
| 과금 방지 | 예산(Budget)과 알림을 걸어 두기: 1 단위 통화 예산, 실제 지출 1% 이상 / 예상 100% 초과 시 메일 |

공식 이미지(`ghcr.io/sentelabsai/...`)는 amd64 전용입니다. 이 구성은 **서버(ARM)나 ARM Mac에서 직접 빌드**합니다.

---

## 3. 전체 순서

### 3-1. Oracle 자원 만들기

**콘솔로 할 경우:** [`deploy/oracle/README.md`](deploy/oracle/README.md)의 1장을 따릅니다 (인스턴스, 고정 IP, Security List).

**CLI로 할 경우 (권장, 재시도 자동):**
```bash
brew install oci-cli
oci session authenticate --region <home-region> --profile-name oe   # 브라우저 로그인, 최대 24시간
bash deploy/oracle/oci-provision.sh --check   # 읽기 전용: 무엇이 있는지
bash deploy/oracle/oci-provision.sh           # 없는 것만 생성, 이미 있으면 재사용
```
- 만드는 것: VCN, 인터넷 게이트웨이, 라우팅, Security List(22/80/443), 서브넷, **고정 IP**, A1 2 OCPU/12GB Ubuntu 24.04 (부트 100GB), SSH 키 `~/.ssh/oe_oracle`
- 고정 IP가 먼저 나오므로, 인스턴스를 기다리는 동안 **도메인 A 레코드를 미리 등록**할 수 있습니다.
- 재시도 간격은 약 30초이고, 요청 과다 제한이 걸리면 2분 쉽니다. Oracle 응답 자체가 1분 정도 걸려서 실제 간격은 약 2분입니다.
- 세션이 만료되면 `oci session authenticate`를 다시 하고 스크립트를 다시 실행하면 이어집니다.

### 3-2. 도메인 연결
DNS를 관리하는 곳(구입처, Route 53, Cloudflare 등)에 **A 레코드 하나**를 추가합니다: `app.example.com → <고정IP>`. Route 53이 꼭 필요하지는 않습니다.
```bash
dig NS example.com +short        # DNS 관리처 확인
dig +short app.example.com       # <고정IP>가 나오면 OK
```
앱을 띄우기 전에 A 레코드가 먼저 있어야 HTTPS 인증서가 발급됩니다.

### 3-3. Google 로그인 (OAuth)
Google Cloud Console → OAuth 동의 화면(외부, 사용자들을 테스트 사용자로 추가) → 사용자 인증 정보 → OAuth 클라이언트 ID(웹)
- 승인된 자바스크립트 원본: `https://app.example.com`
- 승인된 리디렉션 URI: `https://app.example.com/api/auth/callback/google`

### 3-4. Slack (선택)
[`deploy/oracle/slack-manifest.yaml`](deploy/oracle/slack-manifest.yaml)로 앱을 만들고 토큰 두 개를 받습니다.
- App-Level Token(`connections:write`) → `SLACK_APP_TOKEN` (`xapp-…`)
- Install to Workspace → `SLACK_BOT_TOKEN` (`xoxb-…`)

### 3-5. 설정 파일 만들기
서버의 `deploy/oracle/`에 `.env`(도메인), `api.env`(API), `ui.env`(UI) 세 파일이 필요합니다. 모두 gitignore되고 권한은 600입니다.

- **대화형:** 서버에서 `bash deploy/oracle/init-env.sh`
- **YAML 한 파일로:** 저장소 밖에 `secrets.example.yaml`을 복사해 채운 뒤 실행합니다. 값은 출력하지 않고, 어떤 항목이 채워졌는지만 보여 줍니다.
  ```bash
  uv run --with pyyaml --with cryptography python deploy/oracle/env-from-yaml.py ~/Desktop/oe ./server-env
  scp -p -i ~/.ssh/oe_oracle ./server-env/{.env,api.env,ui.env} ubuntu@<서버IP>:OpenExecutive/deploy/oracle/
  ```
- 서버용 공유 키, 로그인 비밀키, 서명 키 쌍은 자동으로 생성됩니다. **서명 비밀키는 `ui.env`에만** 들어가고 API 쪽에는 가지 않습니다.
- `ALLOWED_EMAILS`에는 **오너 한 명만** 넣습니다(아래 4장).
- Slack만 쓸 때는 다른 연동을 끄는 값(`MCP_ENABLED=false` 등)이 명시적으로 들어갑니다.

### 3-6. 서버 준비와 실행
```bash
ssh -i ~/.ssh/oe_oracle ubuntu@<서버IP>
git clone -b deploy/oracle https://github.com/<you>/OpenExecutive.git && cd OpenExecutive
sudo bash deploy/oracle/setup-server.sh     # 부팅 직후 apt 잠금은 자동으로 기다림
exit                                        # docker 권한 적용을 위해 재접속
```
이미지는 둘 중 하나로 준비합니다.
- **서버에서 빌드:** `bash deploy/oracle/oe.sh up` (첫 빌드 20~30분)
- **ARM Mac에서 빌드 후 전송 (빠름):**
  ```bash
  # Mac
  docker build --platform linux/arm64 -f docker/Dockerfile    -t openexecutive-api:local .
  docker build --platform linux/arm64 -f docker/Dockerfile.ui -t openexecutive-ui:local .
  docker save openexecutive-api:local openexecutive-ui:local | gzip -1 > oe-images-arm64.tar.gz
  scp -i ~/.ssh/oe_oracle oe-images-arm64.tar.gz ubuntu@<서버IP>:
  # 서버
  bash deploy/oracle/oe.sh load ~/oe-images-arm64.tar.gz
  bash deploy/oracle/oe.sh up        # 이미지가 있으면 빌드 생략
  ```

### 3-7. 확인
```bash
bash deploy/oracle/oe.sh status                 # api (healthy), 첫 부팅 최대 5분
bash deploy/oracle/oe.sh logs api | grep -i slack   # "Slack socket mode listener connected"
curl -sI https://app.example.com/ | grep -i x-robots-tag
```
외부에서 `https://app.example.com`에 접속하면 로그인 화면이 떠야 하고, `http://`는 `https://`로 넘어가야 합니다. `:8000`, `:3000` 포트는 외부에서 막혀 있어야 합니다.

### 3-8. 매일 백업
서버 시간대는 UTC입니다. 한국 시간 새벽 3시에 백업하려면:
```bash
( crontab -l 2>/dev/null; echo "0 18 * * * bash /home/ubuntu/OpenExecutive/deploy/oracle/oe.sh backup >> /home/ubuntu/oe-backup.log 2>&1" ) | crontab -
```
백업은 `deploy/oracle/backups/`에 쌓입니다(매일 14개, 업데이트 전 백업 5개 보관). 가끔 서버 밖으로 복사해 두세요.

---

## 4. 오너와 사용자

- **처음 로그인한 사람이 오너**가 됩니다. 오너는 People 관리, 워크스페이스 설정 같은 오너 전용 기능을 씁니다.
- 그래서 `ALLOWED_EMAILS`에는 처음에 **오너만** 넣습니다. 오너 항목에 이메일이 비어 있는 동안에는 허용 목록의 다른 사람이 오너 자리를 가져갈 수 있기 때문입니다.
- 순서:
  1. 오너가 로그인 → 온보딩(여러 명이면 팀 모드)
  2. People에서 각자의 Slack 멤버 ID, 선호 채널(Slack)을 입력하고 다른 사람을 팀원으로 추가
  3. 추가된 사람은 People 명단을 통해 로그인 가능 (최대 5분 캐시)
- **오너 변경은 앱 화면에서 할 수 없습니다.** 서버 DB에서 바꿀 수는 있지만, 오너 전용 데이터(개인 연락처 등)가 새 오너에게 넘어가므로 정리한 뒤에 해야 합니다.
- 메인테이너(서버 관리자)는 오너가 아니어도 SSH로 운영합니다.

---

## 5. 운영

| 할 일 | 명령 (서버의 저장소 폴더에서) |
|---|---|
| 상태 / 로그 | `bash deploy/oracle/oe.sh status` / `logs [api\|ui\|caddy]` |
| 업데이트 | `bash deploy/oracle/oe.sh update` (백업 → `git pull` → 재빌드 → 재시작) |
| 설정 변경 반영 | `api.env`/`ui.env` 수정 → `bash deploy/oracle/oe.sh compose up -d` |
| 백업 | `bash deploy/oracle/oe.sh backup` |
| 정지 | `bash deploy/oracle/oe.sh down` (데이터 유지). **`down -v`는 절대 금지** |

**코드 갱신 규칙:** 서버가 따라가는 `deploy/oracle` 브랜치에는 **merge만** 합니다. rebase나 force-push를 하면 서버의 `git pull --ff-only`가 실패합니다.
```bash
git checkout deploy/oracle && git merge feat/korean-ui && git push
```
업데이트할 때 Mac에서 이미지를 빌드해 보내려면 3-6의 방법으로 `load` 후 `oe.sh compose up -d`를 실행합니다.

### 검색엔진 차단
기본으로 켜져 있습니다. `robots.txt`(`Disallow: /`)와 모든 응답의 `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex`가 적용됩니다.

### 외부 MCP 클라이언트 (예: ChatGPT)
`/mcp`는 기본으로 외부에 닫혀 있습니다. 헤더 인증을 못 하는 클라이언트(ChatGPT 커넥터는 OAuth나 "인증 없음"만 지원)를 위해 비밀 경로를 열 수 있습니다.
```bash
bash deploy/oracle/oe.sh mcp-on       # 비밀 주소 생성 + 출력
bash deploy/oracle/oe.sh mcp-rotate   # 주소 교체 (유출 시)
bash deploy/oracle/oe.sh mcp-off      # 닫기
```
- **주소 자체가 비밀번호**입니다. 가진 사람은 회사 자료 조회와 전문가 상담(모델 비용 발생)을 할 수 있지만 오너 권한은 없습니다.
- ChatGPT: 설정 → 커넥터/Plugins → 고급 → **개발자 모드** → 커넥터 만들기 → URL 입력, 인증 "없음". 메뉴 이름과 플랜별 지원 여부는 바뀔 수 있습니다.
- Claude Desktop, Claude Code처럼 헤더를 보낼 수 있는 클라이언트는 `x-api-key` 방식도 가능합니다(README의 "Connect as an MCP Server").

### 이름 (Hoiv Executive)
화면, 사용자 가이드, 결과물 문구, Slack 봇 이름은 코드에서 바꿨습니다. Executive가 스스로 부르는 이름은 `api.env`의 `EXEC_DISPLAY_NAME='Hoiv Executive'`입니다. 프롬프트와 패키지 이름은 그대로라서 프롬프트 캐시에 영향이 없습니다.

---

## 6. 사용 환경

- **Slack vs 웹:** Executive, 전문가, 지식, 메모리, 도구는 같습니다. Slack은 텍스트만 지원해서 버튼과 카드가 없고, 설정·승인·People 관리는 웹에서 합니다. Slack에서는 People에 Slack ID가 등록된 팀원만 대화할 수 있습니다.
- **모바일:** 반응형이라 휴대폰 브라우저에서 하단 탭바와 서랍 메뉴로 동작합니다. 앱스토어 앱이나 홈 화면 앱(PWA) 설정은 없습니다. 휴대폰에서는 Slack 앱이 더 편할 수 있습니다.
- **사진 업로드:** 웹 채팅에서 PNG/JPEG/GIF/WebP(및 PDF, Word, TXT, MD, CSV)를 파일당 20MB까지 첨부할 수 있습니다.
- **Notion 동기화:** 앱 화면에서는 켤 수 없고, `api.env`의 `NOTION_SYNC_ENABLED=true` + `NOTION_API_KEY`로 켭니다.

---

## 7. 문제 해결

| 증상 | 원인 / 해결 |
|---|---|
| `Out of host capacity` | A1 자리 없음. `oci-provision.sh`를 계속 돌리거나 PAYG로 업그레이드 |
| `TooManyRequests` | 요청 과다 제한. 스크립트가 2분 쉬고 다시 시도 |
| `oci` 명령이 재인증을 묻고 멈춤 | 세션 만료. `oci session authenticate --region <home-region> --profile-name oe` |
| `setup-server.sh`에서 `Could not get lock` | 이전 버전 스크립트. 최신 스크립트는 apt 잠금을 기다림 |
| 접속 시간 초과 | Security List 80/443, `setup-server.sh` 실행 여부 확인 |
| 인증서 오류 | A 레코드 확인(`dig +short`), Cloudflare면 DNS only. 이후 `oe.sh restart caddy` |
| `redirect_uri_mismatch` | Google 쪽 리디렉션 URI가 `https://<도메인>/api/auth/callback/google`과 정확히 같은지 확인 |
| 로그인 후 `AccessDenied` | `ALLOWED_EMAILS` 또는 People 명단에 그 이메일이 없음 |
| `make docker`에서 UI가 영어 | `OE_LANGUAGE`가 UI 컨테이너에 전달되지 않음. 이 브랜치에서 수정됨 |
