# Oracle Cloud에 Open Executive 배포하기

VM 한 대에 Docker로 세 개의 컨테이너를 띄웁니다.

```
브라우저 ──HTTPS──▶ Caddy(80/443, 인증서 자동 발급·갱신)
                      └─▶ UI (Next.js, 내부 3000)
                            └─▶ API (FastAPI, 내부 8000) ── /data 볼륨 (SQLite, Chroma, 회사 자료)
```

- 인터넷에 열리는 건 Caddy(80/443)뿐입니다. API와 UI는 Docker 내부 네트워크에만 있습니다.
- API는 반드시 **한 개만** 띄웁니다. 두 개면 예약된 메일과 브리핑이 두 번씩 나갑니다(`docs/deployment.md`).
- 서버에서 이미지를 직접 빌드합니다. 공식 이미지는 amd64 전용이고, 이 브랜치의 한국어 변경도 들어 있지 않기 때문입니다. ARM64(`linux/arm64`) 빌드와 전체 스택 실행도 확인했습니다.

| 파일 | 하는 일 |
|---|---|
| `setup-server.sh` | 새 Ubuntu 서버 준비: Docker 설치, 방화벽 80/443 열기, 스왑 4GB, 로그 크기 제한 |
| `init-env.sh` | 설정 파일 3개 생성(`.env`, `api.env`, `ui.env`, 모두 gitignore). 비밀값은 자동 생성 |
| `oe.sh` | 운영 명령: `up`, `update`, `status`, `logs`, `backup`, `restart`, `down` |
| `docker-compose.yml`, `Caddyfile` | 운영용 스택 |

---

## 0. 준비물

- **Oracle Cloud 계정**: https://signup.cloud.oracle.com (카드 인증이 필요하지만 Always Free 범위 안에서는 과금되지 않습니다)
- **도메인**: 예) `exec.mydomain.com`으로 쓸 도메인 하나
- **Anthropic API 키**: https://console.anthropic.com
- **Executive가 쓸 이메일 주소**: Executive가 메일을 보내는 주소(`EXEC_EMAIL_ADDRESS`). 메일 연동은 나중에 해도 되지만 값은 처음부터 필요합니다.
- **로그인용 Google OAuth 클라이언트**: 3단계에서 만듭니다. 공개 서버는 로그인 없이 쓸 수 없습니다.

---

## 1. Oracle에 서버 만들기

### 1-1. 인스턴스 생성

1. 콘솔 왼쪽 위 ☰ → **Compute → Instances → Create instance**
2. **Image**: *Change image* → **Canonical Ubuntu 24.04**
3. **Shape**: *Change shape* → **Ampere → VM.Standard.A1.Flex**
   - OCPU **2**, 메모리 **12 GB**를 권장합니다. Always Free는 A1 합계 4 OCPU / 24 GB까지 무료입니다.
   - AMD `VM.Standard.E2.1.Micro`(1 GB)는 메모리가 부족해서 이 앱을 못 돌립니다(API만 2 GB 필요).
4. **Networking**: *Create new virtual cloud network*, *public subnet*, **Assign a public IPv4 address** 체크
5. **Add SSH keys**: *Generate a key pair for me* → **Save private key**로 키 파일을 받아 둡니다. 이미 쓰는 공개키가 있으면 붙여 넣어도 됩니다.
6. **Boot volume**: *Specify a custom boot volume size* → **100 GB** (Always Free는 합계 200 GB까지 무료)
7. **Create**

> **"Out of capacity" 오류가 날 때**: A1은 인기가 많아 자리가 없을 때가 있습니다. 다른 Availability Domain을 고르거나, 시간을 두고 다시 시도하세요. 계정을 *Pay As You Go*로 올리면 자리를 잡기 훨씬 쉽습니다. 무료 한도 안에서 쓰면 여전히 0원입니다.

### 1-2. 고정 IP(Reserved Public IP)로 바꾸기

기본 공인 IP(ephemeral)는 인스턴스를 다시 만들면 바뀝니다. 도메인을 연결할 거라 고정 IP로 바꿔 둡니다(Always Free에 포함).

1. 인스턴스 상세 → **Attached VNICs** → VNIC 클릭 → **IPv4 Addresses**
2. 기본 private IP 줄의 ⋮ → **Edit** → *Public IP type*: **No public IP** → 저장
3. 다시 ⋮ → **Edit** → **Reserved public IP** → *Create new reserved IP* → 저장
4. 새로 보이는 공인 IP를 적어 둡니다. 이후 `<서버IP>`로 표기합니다.

### 1-3. 80/443 포트 열기 (VCN Security List)

Oracle은 클라우드 방화벽(Security List)과 서버 안 방화벽(iptables)을 둘 다 열어야 합니다. 서버 안쪽은 `setup-server.sh`가 처리하고, 여기서는 클라우드 쪽을 엽니다.

1. 인스턴스 상세 → **Primary VNIC**의 *Subnet* 클릭 → **Security Lists** → *Default Security List…*
2. **Add Ingress Rules**를 눌러 아래 두 규칙을 추가합니다.
   - Source CIDR `0.0.0.0/0`, IP Protocol **TCP**, Destination Port **80**
   - Source CIDR `0.0.0.0/0`, IP Protocol **TCP**, Destination Port **443**

SSH(22)는 기본으로 열려 있습니다.

---

## 2. 도메인 연결하기 — Route 53이 꼭 필요하지는 않습니다

도메인 연결은 **A 레코드 하나**면 됩니다. `exec.mydomain.com → <서버IP>`. 그 레코드는 지금 도메인의 DNS를 관리하는 곳에 만들면 되고, Oracle 쪽에서 할 일은 없습니다.

| 도메인 DNS를 관리하는 곳 | 할 일 |
|---|---|
| **AWS Route 53** (Hosted zone이 이미 있음) | Route 53 → Hosted zones → 도메인 → **Create record**: Record name `exec`, Type **A**, Value `<서버IP>`, TTL 300 |
| **Cloudflare** | DNS → **Add record**: Type A, Name `exec`, IPv4 `<서버IP>`, Proxy status **DNS only(회색 구름)**로 시작하기 |
| **가비아, 후이즈, Namecheap 등 구입처** | 해당 사이트의 DNS 관리 화면에서 같은 A 레코드 추가 |

도메인을 어디서 샀는지와 DNS를 어디서 관리하는지는 다를 수 있습니다. 확인하려면 `dig NS mydomain.com +short`를 실행하세요. `awsdns`가 보이면 Route 53, `cloudflare`가 보이면 Cloudflare입니다.

연결 확인(몇 분에서 길게는 한 시간쯤 걸릴 수 있음):

```bash
dig +short exec.mydomain.com     # <서버IP>가 나오면 됨
```

**앱을 띄우기 전에 A 레코드가 먼저 있어야 합니다.** Caddy는 시작할 때 Let's Encrypt로 인증서를 받는데, 도메인이 서버를 가리키지 않으면 발급에 실패하고 계속 재시도합니다.

---

## 3. 로그인용 Google OAuth 클라이언트 만들기

1. https://console.cloud.google.com → 프로젝트 선택 또는 생성
2. **APIs & Services → OAuth consent screen**: User type *External*, 앱 이름과 이메일을 입력합니다. *Test users*에 본인 Gmail을 추가하거나 앱을 *Publish*합니다.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URIs: `https://exec.mydomain.com/api/auth/callback/google`
4. 나오는 **Client ID**와 **Client secret**을 적어 둡니다.

회사 SSO(OIDC)를 쓰려면 `docs/auth.md`의 *SSO sign-in* 절을 보고 `ui.env`의 `AUTH_OIDC_*`를 채우면 됩니다.

---

## 4. 서버 설정과 실행

내 컴퓨터에서 접속합니다:

```bash
chmod 600 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key ubuntu@<서버IP>
```

서버에서:

```bash
# 코드 받기 (한국어 UI + 이 배포 구성이 있는 브랜치)
git clone -b deploy/oracle https://github.com/y0ngha/OpenExecutive.git
cd OpenExecutive

# 서버 준비 (Docker, 방화벽, 스왑) — 한 번만
sudo bash deploy/oracle/setup-server.sh
exit                                  # docker 그룹 적용을 위해 다시 접속
```

```bash
ssh -i ~/Downloads/ssh-key-*.key ubuntu@<서버IP>
cd OpenExecutive

# 설정 파일 만들기: 도메인, 이메일, API 키, Google 클라이언트를 물어봅니다
bash deploy/oracle/init-env.sh

# 빌드 + 실행 (첫 빌드는 A1 2 OCPU 기준 20~30분 걸립니다)
bash deploy/oracle/oe.sh up

# 상태 확인: api가 (healthy)가 되면 준비 완료 (첫 부팅은 최대 5분)
bash deploy/oracle/oe.sh status
```

브라우저에서 `https://exec.mydomain.com`에 접속해 Google로 로그인하면 설정 마법사(온보딩)가 시작됩니다. 처음에 "회사 프로필 없음"이 보이는 것은 정상입니다.

---

## 5. 운영

| 하고 싶은 일 | 명령 |
|---|---|
| 상태 보기 | `bash deploy/oracle/oe.sh status` |
| 로그 보기 | `bash deploy/oracle/oe.sh logs` (특정 서비스만: `logs api`) |
| 새 코드로 업데이트 | `bash deploy/oracle/oe.sh update` (백업 → `git pull` → 재빌드 → 재시작) |
| DB 백업 | `bash deploy/oracle/oe.sh backup` → `deploy/oracle/backups/` (최근 14개 보관) |
| 설정을 바꾼 뒤 적용 | `api.env`/`ui.env` 수정 → `bash deploy/oracle/oe.sh compose up -d` |
| 멈추기 | `bash deploy/oracle/oe.sh down` (데이터는 유지) |

**매일 자동 백업**(새벽 3시). `crontab -e`에 아래 한 줄을 추가합니다:

```
0 3 * * * bash /home/ubuntu/OpenExecutive/deploy/oracle/oe.sh backup >> /home/ubuntu/oe-backup.log 2>&1
```

백업은 같은 서버 안에 쌓입니다. 서버를 잃어도 남게 하려면 가끔 `scp`로 내 컴퓨터에 받아 두거나 Oracle Object Storage에 올리세요.

```bash
scp -i <키> ubuntu@<서버IP>:OpenExecutive/deploy/oracle/backups/*.db ./
```

**절대 하지 말 것**: `docker compose down -v`. `-v`는 데이터 볼륨(대화, 사람, 메모리 전부)을 지웁니다.

### Slack, Telegram, Gmail 등 연동 추가

저장소의 `.env.example`에서 필요한 줄을 `deploy/oracle/api.env`로 복사해 값을 채운 뒤 `bash deploy/oracle/oe.sh compose up -d`를 실행합니다. 각 연동 문서(`docs/*_setup.md`)와 `docs/deployment.md`의 Google Workspace / Microsoft 365 절에서 `docker compose` 명령은 `bash deploy/oracle/oe.sh compose …`로 바꿔 실행하면 됩니다.

---

## 6. 문제 해결

| 증상 | 원인과 해결 |
|---|---|
| 브라우저에서 접속이 안 됨(시간 초과) | Security List에 80/443이 없거나 `setup-server.sh`를 안 돌림. 1-3을 확인하고 `sudo iptables -L INPUT -n --line-numbers`에서 80/443 ACCEPT가 REJECT보다 위에 있는지 확인 |
| 인증서 오류, `logs caddy`에 `challenge failed` | A 레코드가 아직 서버를 가리키지 않음(`dig +short`로 확인). Cloudflare면 DNS only로. 고친 뒤 `oe.sh restart caddy` |
| Google 로그인에서 `redirect_uri_mismatch` | 3단계 redirect URI가 `https://<도메인>/api/auth/callback/google`과 정확히 같은지 확인(반영까지 몇 분 걸림) |
| 로그인 후 `AccessDenied` | 그 이메일이 `ui.env`의 `ALLOWED_EMAILS`에 없음. 추가 후 `oe.sh restart ui` |
| `oe.sh up` 중 빌드가 메모리 부족으로 죽음 | 스왑이 없거나 인스턴스가 너무 작음. `free -h`로 확인하고 A1 2 OCPU / 12 GB 이상 권장 |
| api가 계속 재시작 | `oe.sh logs api`에서 `ValidationError`가 가리키는 변수를 `api.env`에 설정 |
