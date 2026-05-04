# 藤井工藝 OBD DASH Ver.3

**Mini F56 JCW など 専用 BLE OBD2 リアルタイムダッシュボード**

![PWA](https://img.shields.io/badge/PWA-対応-4AABFF?style=flat-square)
![BLE](https://img.shields.io/badge/接続-BLE%20ELM327-22e54a?style=flat-square)
![Platform](https://img.shields.io/badge/Android%20Chrome-専用-orange?style=flat-square)

---

## ファイル構成

```
obd2-dashboard_ver3/
├── index.html       # HTML 構造のみ
├── styles.css       # 全 CSS
├── app.js           # 全 JavaScript ロジック
├── sw.js            # Service Worker (PWAキャッシュ管理)
├── manifest.json    # PWA マニフェスト
└── README.md        # 本ファイル
```

> 単一HTML 構成から、HTML / CSS / JS の3ファイルに分離しました。  
> メンテナンス性・キャッシュ効率・読み込み速度すべて改善されています。

---

## 主な機能

### 9種類 + TIMER の 10種類のウィジェット

| キー | ラベル | 単位 | OBD PID | 警告 |
|---|---|---|---|---|
| `gear` | GEAR | - | 010C, 010D | - |
| `speed` | SPEED | km/h | 010D | - |
| `intake` | INTAKE | °C | 010F | 70°C↑ |
| `coolant` | COOLANT | °C | 0105 | 105°C↑ |
| `oiltemp` | OIL TEMP | °C | 015C | 130°C↑ |
| `boost` | BOOST | kg/cm² | 010B | - |
| `throttle` | THROTTLE | % | 0111 | - |
| `insthp` | EST.HP | PS | 010B, 010C | - |
| `gball` | G-METER | G | (加速度センサー) | 設定値↑ |
| `timer` | **TIME** | HH:MM | (BT接続時刻ベース) | - |

### パネル数 0〜5 可変

CFG画面で `0 / 1 / 2 / 3 / 4 / 5` から選択。等幅で自動分割。  
**0個選択時は下部エリアが消えてRPM領域がフル画面に拡張。**

### OBD取得最適化

各ウィジェットは必要なPIDを宣言しており、**表示中のウィジェットだけポーリング**します。

- **高頻度 (毎サイクル)**: RPM (010C)、速度 (010D)
- **低頻度 (順番に1個ずつ)**: 表示中ウィジェットが要求するスロー系PID

設定変更・ウィジェット選択変更で自動再計算 → 不要PIDを取得しない分、**レスポンス速度が向上**。

---

## TIMER 機能（Ver.3.1 新規）

### 仕様
- **計測単位**: 分（HH:MM 形式）
- **開始タイミング**: BT接続成功時
- **リセット**: 切断時に 00:00 にリセット
- **再接続**: 再度カウント開始

### 状態管理
- `S.elapsedSec` (秒単位、状態オブジェクトに保持)
- `_btConnectedAt` (接続時刻 ms)、null=未接続
- **1秒間隔のバックグラウンドタイマーで常時更新**
- **ウィジェットとして選択していなくても裏で計測継続** → 後から選択しても正しい値が表示される

### 計算ロジック
```js
S.elapsedSec = Math.floor((Date.now() - _btConnectedAt) / 1000);
formatTime(sec) → "HH:MM"
```

---

## G-METER 仕様（Ver.3.2 大幅改善）

### 座標系
- スマートフォンを **「立てた状態（画面が垂直）」** で使用想定
- 重力ベクトルをローパスフィルタ(α=0.92)で動的推定し、**自動で除去**
- 円の中央 = 0G、端 = 設定値（例: 1.5G）

### 画面回転対応（Ver.3.2 新機能）
`screen.orientation.angle` または `window.orientation` で画面の回転を取得し、加速度ベクトルを座標変換します。

| 回転角 | 状態 | 横G軸 (sx) | 縦G軸 (-lz) |
|---|---|---|---|
| 0° | 縦持ち | 端末x | 端末-z |
| 90° | 反時計90°（内カメラ右） | 端末y | 端末-z |
| 180° | 上下逆さ | 端末-x | 端末-z |
| 270° | 時計90°（内カメラ左） | 端末-y | 端末-z |

#### 数式
```
sx =  lx*cos(θ) + ly*sin(θ)   ← 画面右方向の横G成分
S.gx = sx * G_PER_MS2 * (反転)
S.gy = -lz * G_PER_MS2 * (反転)
```

→ **端末をどの向きに回しても画面基準でドットが動く**

### 表示
- **横軸**: 旋回G (L/R)
- **縦軸**: 加減速G (F=Forward加速 / B=Brake減速)  ※Ver.3.2でA→Fに変更
- 数値表示は撤去済み（円のレーダー表示のみに簡素化）

### アスペクト比修正
高さベースのサイズ計算 + `max-width:100%; max-height:100%` で、**どんなパネル幅でも円が完全に枠内に収まる**ように修正済み。

### アラート
- 合成G `√(横²+縦²)` が閾値を超えるとドット＆円が**赤く塗りつぶし発光**
- CFGで閾値をG単位で文字入力（例: 1.0）

### 設定 (CFG)
- 表示範囲 `gMaxG` (G)
- アラート閾値 `gAlertG` (G)
- 軸反転 (横/縦個別)
- **キャリブレーション**: 「今この姿勢をセンター」ボタンで即時ゼロ点リセット

---

## デフォルト設定（Mini F56 JCW）

| 項目 | 値 |
|---|---|
| 最終減速比 | 3.502 |
| タイヤ外径 | 616 mm |
| ギア段数 | 6速 |
| ギア比 | 4.459 / 2.508 / 1.556 / 1.142 / 0.851 / 0.672 |
| RPM ドット数 | 12 |
| 警告 RPM | 4,800 |
| ブースト範囲 | -0.5 〜 2.0 kg/cm² |
| HP係数 | 0.000197 |
| G表示範囲 | 1.5 G |
| Gアラート | 1.0 G |

---

## 動作環境

| 環境 | 状況 |
|---|---|
| Android Chrome（最新版） | ✅ 対応 |
| iOS Safari | ❌ 非対応 (Web Bluetooth 未実装) |
| PC Chrome | ⚠️ BLE接続のみ可、画面サイズ非最適 |

---

## デプロイ手順 (GitHub Pages)

1. 新規リポジトリ作成
2. このディレクトリの**全6ファイル**をプッシュ
3. Settings → Pages → Branch: main / root を指定
4. 公開URLを Android Chrome で開く
5. 「ホーム画面に追加」でPWA化、フルスクリーン使用

### 更新時のキャッシュ対策

`sw.js` の `CACHE_VERSION` を必ず変更（例: `v3-002` → `v3-003`）。  
これで旧キャッシュが自動破棄され、新バージョンが反映されます。

---

## 技術スタック

- Vanilla HTML / CSS / JavaScript（フレームワーク不使用、外部依存ゼロ）
- Web Bluetooth API (BLE GATT)
- DeviceMotion API (Gメーター)
- Screen Orientation API (画面回転検出)
- ELM327 AT コマンド (OBD2)
- Service Worker + Web App Manifest (PWA)
- localStorage (設定保存)

---

## バージョン履歴

### Ver.3.2 (現在)
- G-METER 画面回転対応 (端末をどう持っても画面基準でドット動作)
- G-METER 数値表示削除、ラベル A→F に変更
- G-METER 円のアスペクト比を高さベースに修正 (パネルにきっちり収まる)
- TIMER ウィジェット追加 (BT接続経過時間 HH:MM、常時バックグラウンド計測)
- HTML/CSS/JS のファイル分離

### Ver.3.1
- パネル数 0〜5 可変
- 絵文字削除、テキストベースのピッカーに変更
- OBD取得最適化（表示中ウィジェットのみ）
- Gアラート機能、キャリブレーション

### Ver.3.0
- 下半分パネル全スロット選択式
- ギアもウィジェット化、任意位置に配置可能
- 9種類のウィジェット (G-METER / Est.HP / Throttle 等を新規追加)

---

## 注意事項

- 本アプリは個人使用目的で作成されています
- 走行中の操作は危険です。**停車中または同乗者による操作**を推奨します
- OBD2 ドングルの品質・互換性により一部 PID が取得できない場合があります
- Est.HP は推定値であり、実測値ではありません

---

**藤井工藝**  
*Powered by Web Bluetooth API + ELM327*

https://fuziikogei.handcrafted.jp/
