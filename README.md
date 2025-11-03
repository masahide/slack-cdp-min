以下を `README.md` に貼ればそのまま使えます。必要に応じてパスやポート番号だけ調整してください。

---

# WSL から Windows 上の Chrome/Electron（Slack など）の CDP に接続する方法

Windows で動いている Slack（Electron）や Chrome/Edge の **Chrome DevTools Protocol (CDP)** に、**WSL** 側から接続するための手順です。
Electron アプリは `--remote-debugging-address` を無視して **127.0.0.1 固定で待受け**ることが多く、WSL の `localhost` からは届きません。そこで **Windows の `portproxy`** で中継口を作ります。

> 僕の意見：この方式がシンプルで安定します。WSL の仮想 NIC の IP は変わることがあるので、毎回スクリプトで自動取得する前提にすると安心。

---

## TL;DR

1. （Windows・管理者 PowerShell/CMD）`portproxy` を作成
   → `.\hack\cdp_portproxy.ps1` または `.\hack\cdp_portproxy_simple.bat` を実行
2. （Windows）Slack/Chrome を起動して **DevTools listening** を確認
3. （WSL）`curl http://<表示された Windows 側IP>:9222/json/version` で見えることを確認
4. （WSL）`ws://<同IP>:9222/...` に Puppeteer/Chromedp などで接続

---

## 1) 前提

* このリポジトリパス（例）：`C:\Users\ck000\git\reaclog`
* スクリプト：

  * PowerShell 版：`hack/cdp_portproxy.ps1`
  * バッチ版（CMD）：`hack/cdp_portproxy_simple.bat`

> どちらも **管理者権限** で実行してください。
> 文字コードは **UTF-8 (BOMなし)** 推奨、改行は **CRLF**。

---

## 2) Windows 側の中継口を作る（portproxy）

### PowerShell 版（推奨）

```powershell
# 管理者 PowerShell で、リポジトリ直下へ移動
cd C:\Users\ck000\git\reaclog

# 実行ポリシー一時的に緩める（必要な場合のみ）
Set-ExecutionPolicy -Scope Process Bypass -Force

# 9222 で作成
.\hack\cdp_portproxy.ps1

# 別ポートで作成（例：9333）
.\hack\cdp_portproxy.ps1 -Port 9333

# 削除（9222）
.\hack\cdp_portproxy.ps1 -Mode remove

# 削除（9333）
.\hack\cdp_portproxy.ps1 -Mode remove -Port 9333
```

### バッチ版（CMD で実行したい場合）

```bat
REM 管理者 CMD で
cd C:\Users\ck000\git\reaclog

REM 9222 で作成
.\hack\cdp_portproxy_simple.bat

REM 別ポートで作成（例：9333）
.\hack\cdp_portproxy_simple.bat 9333

REM 削除（9222）
.\hack\cdp_portproxy_simple.bat remove

REM 削除（9333）
.\hack\cdp_portproxy_simple.bat remove 9333
```

> スクリプトは自動で **vEthernet(WSL)** の IPv4 を取得し、
> `WSLから見えるWindowsのIP:PORT → 127.0.0.1:PORT` に **portproxy** を張ります。
> ついでに **Windows ファイアウォール** に WSL サブネット（`172.16.0.0/12`）限定の許可規則も追加します。

---

## 3) Windows 側で Slack/Chrome を CDP 有効にして起動

### Electron（Slack など）

Slack は `--remote-debugging-address` を無視して `127.0.0.1` にだけバインドされます。
以下のように起動して **「DevTools listening on ws://127.0.0.1:9222/…」** のログが出ればOK。

```bat
"C:\Program Files\WindowsApps\com.tinyspeck.slackdesktop_4.46.104.0_x64__8yrtsj140pw4g\app\Slack.exe" ^
  --remote-debugging-port=9222
```

### Chrome/Edge（参考）

Chrome/Edge は `--remote-debugging-address` が効きます（WSL 直結したい場合）。
ただしこの README の手順（portproxy）なら `address` 指定は不要です。

---

## 4) WSL からの接続確認

スクリプト実行後、PowerShell かバッチの出力に **Windows 側 IP** が表示されます。
その IP を使って WSL から疎通確認：

```bash
# 例）WSL 上
curl http://<Windows側IP>:9222/json/version
# → JSON が返ればOK
curl http://<Windows側IP>:9222/json/list
```

---

## 5) クライアントからの接続例

### Puppeteer（Node.js, WSL 側）

```js
import puppeteer from "puppeteer-core";

const wsEndpoint = "ws://<Windows側IP>:9222/devtools/browser/<browser-id-or-page-id>";

const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
const page = await browser.newPage();
await page.goto("https://example.com");
console.log(await page.title());
```

> `browser-id` や `page` の `webSocketDebuggerUrl` は
> `http://<Windows側IP>:9222/json/version` や `/json/list` で取得できます。

### chromedp（Go, WSL 側）

```go
package main

import (
  "context"
  "log"
  "time"

  "github.com/chromedp/chromedp"
)

func main() {
  const wsURL = "ws://<Windows側IP>:9222/devtools/browser/<your-browser-id>"

  ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
  defer cancel()

  alloc, cancelA := chromedp.NewRemoteAllocator(ctx, wsURL)
  defer cancelA()

  cctx, cancelC := chromedp.NewContext(alloc)
  defer cancelC()

  var title string
  if err := chromedp.Run(cctx,
    chromedp.Navigate("https://example.com"),
    chromedp.Title(&title),
  ); err != nil {
    log.Fatal(err)
  }
  log.Println("Title:", title)
}
```

---

## 6) うまくいかないとき

* **WSL → 127.0.0.1:9222 は不可**
  それは WSL のループバック。Windows 側の `127.0.0.1` とは別です。
* **Slack/Electron ログに `DevTools listening on ws://127.0.0.1:9222/...` が出ているか**
  出ていなければ CDP が有効化できていません。
* **portproxy が有効か**
  `netsh interface portproxy show all`（Windows側）で確認。
* **ファイアウォール**
  ルールが作成されているか。社内 AV/EDR がブロックしていないか。
* **サービス `iphlpsvc`（IP Helper）**
  停止していると `portproxy` は機能しません。スクリプトが自動起動しますが手動で確認してもOK。
* **WSL 側 IP 変更**
  WSL 再起動等で Windows 側の仮想 NIC IP が変わることがあります。スクリプトを再実行してください。
* **別ポートが必要**
  `.\hack\cdp_portproxy.ps1 -Port 9333` のように変更可能。

---

## 7) 片付け（削除）

```powershell
# PowerShell 版
.\hack\cdp_portproxy.ps1 -Mode remove         # 既定(9222)
.\hack\cdp_portproxy.ps1 -Mode remove -Port 9333
```

```bat
REM バッチ版
.\hack\cdp_portproxy_simple.bat remove
.\hack\cdp_portproxy_simple.bat remove 9333
```

---

## セキュリティ注意

* `0.0.0.0` へのバインドは避け、**WSL サブネットに限定**する（本手順は既に限定）
* ポートを開けっぱなしにしない。不要時は **remove** で削除
* 信頼できるローカル環境以外に **CDP を公開しない**

---

## 参考メモ

* CDP エンドポイント：

  * `http://<Windows側IP>:9222/json/version`（`webSocketDebuggerUrl` 取得）
  * `http://<Windows側IP>:9222/json/list`（ページ一覧）
* 典型ログ（Slack/Electron）：

  * `DevTools listening on ws://127.0.0.1:9222/devtools/browser/<id>`

---

以上。README 化はここまででOK。必要なら、`npm run` で portproxy を作る小タスク（`powershell -File hack/cdp_portproxy.ps1` を呼ぶ）を追加しても便利です。
