# Byte-Muse 隔离部署与番号搜索实测

2026-11-06（Asia/Shanghai）。用户要求在 OVH 部署 Byte-Muse，验证大小写及去横杠输入通过聚合后的实际搜索行为。本轮只部署和搜索，没有修改聚合应用代码。

## 隔离实例

- 容器：`byte-muse-bt-test`；独立 Compose 项目 `bytemuse-bm-bt-test`。
- 数据与配置：`/root/docker/bytemuse-bm-bt-test-20261106/data`；Compose 为上一级的 `compose.json`。
- 界面版本：`v1.32.0`。固定使用现有 Byte-Muse 的同一镜像 ID，未拉取或替换现有 `latest` 镜像。
- 镜像 ID：`sha256:6ffe7a6fb77f0b45c002ca3372468dd1ba0d9f418dfb3c42f207eb3ca2cf867d`。
- 仓库摘要：`envyafish/byte-muse@sha256:ec672cbb201fed54fa5613e20cff90dfc287e03058173bf53b5ccd2a3ebbe558`；该本地镜像创建于 2026-10-20，并非本轮对 Docker Hub 最新版本的确认。
- 端口：宿主机 `13750 → 3750`，仅绑定 loopback 和 OVH Tailscale 地址。未新增公网监听。
- 网络：现有 `bm-bt-proxy-prod_default`；BT_URL 指向 `http://bm-bt-proxy:8000/api/torrents`，方法 `get`，JSON 参数为空。
- 新数据、新登录账号；原实例的数据、账号和容器未改变。测试登录信息仅在私有文件保存，不进入 Git。
- 限制为 1 CPU、1 GiB 内存，最终观察内存约 162.5 MiB；实例继续运行，便于用户复查。

测试实例未配置下载客户端、网盘或消息渠道；定时订阅任务使用独立配置。测试操作没有点击订阅或下载，最终测试数据库 `history` 为 0。

## 接口及网页实测

先用已认证的 Byte-Muse `/api/v1/torrents/search?query=...` 逐项检查，再在可见 Chromium 中登录、进入「搜索」、输入相同六种写法并按 Enter。网页请求仍携带用户输入的原始 `query`；聚合 SQLite 请求历史记录的是经过 Byte-Muse 后实际送达的关键词。

| Byte-Muse 输入 | 接口返回 | 网页下载按钮 | 聚合实际收到 |
|---|---:|---:|---|
| `SSIS-586` | 8 条 | 8 个 | `SSIS-586` |
| `ssis-586` | 8 条 | 8 个 | `SSIS-586` |
| `SsIs-586` | 8 条 | 8 个 | `SSIS-586` |
| `SSIS586` | 8 条 | 8 个 | `SSIS-586` |
| `ssis586` | 8 条 | 8 个 | `SSIS-586` |
| `SsIs586` | 8 条 | 8 个 | `SSIS-586` |

六种写法的下载链接集合完全一致。接口检查 6 项、网页检查 6 项均通过，网页无未捕获 JavaScript 异常。另两次网页探索搜索也成功；本轮对照的 14 条聚合请求全部记录为 `SSIS-586`、完整成功、两个目标源成功、8 条聚合结果。

接口测试及网页测试的结果摘要使用不同语言的 JSON 序列化方式计算，摘要字符串不能跨组直接比较；每组内部均验证六种输入的结果集合一致。没有把磁力链接或作品正文保存进提交的证据。

## 结论与范围

在这套实际部署的 Byte-Muse v1.32.0 中，大小写及无横杠番号会先归一化，再访问 BT 聚合。`ssis586 → Byte-Muse → SSIS-586 → 聚合 → 两个源 → 8 条结果` 的完整搜索链路已验证。

此前直接向聚合提交 `ssis586` 返回 0 条的实测仍然成立：聚合本身原样转发，两个源对此样本都不做补横杠。区别在于请求是否经过 Byte-Muse。不能据直接聚合的结果断言 Byte-Muse 接入链路缺少此能力。

因此无需为了 Byte-Muse 这条接入链路立刻改聚合关键词逻辑；如果要求聚合自己的搜索页、其它客户端也能输入无横杠番号，可另外补同等能力。

证据见 `frontend-verification/bytemuse-search-results.json`。测试容器和原 `byte-muse`、`bm-bt-proxy` 的 ID、启动时间及镜像分别比对；原两项均未重启、未替换，聚合源配置字节未变。

本轮只验证一个已知样本的六种写法，不承诺所有番号格式都能补横杠，也未验证 FC2、带数字前缀、特殊后缀或普通名称的归一化规则；未订阅、未下载、未更改生产聚合应用。

## 运行与移除

登录地址为 OVH 的 Tailscale `13750` 端口，需要处于相应 tailnet。新账号凭据保存在服务器发布目录的 `login.json`，以及本地 `.preview-data/release/bytemuse-test-login.json`（权限 600）；未写入报告。

只停止本轮测试实例：

```sh
docker compose -p bytemuse-bm-bt-test -f /root/docker/bytemuse-bm-bt-test-20261106/compose.json stop
```

恢复测试实例可将末尾 `stop` 换成 `up -d --no-deps`。移除容器可用同一 Compose 文件执行 `down`，不会删除独立数据，也不会影响原生产项目。
# 2026-11-07 发布前扩展检查

本次串行扩展了 14 种输入，使用真实 Byte-Muse API，并逐次核对聚合端持久记录；未执行下载或订阅。最初一轮全部为空且无聚合业务记录，进一步跟踪确认入口返回 HTTP 401：当前生产 API Key 已启用，而隔离 Byte-Muse 没有携带该 Key。仅同步隔离实例的 `BT_HEADER` 并重启隔离实例后，以下检查通过，未更改生产鉴权或原 Byte-Muse 配置。401 不应被解读为源站零结果。

| 输入 | Byte-Muse 发给聚合的关键词 | 去重后条数 |
|---|---|---:|
| `SSIS-586` / `ssis586` | `SSIS-586` | 8 / 8，同一结果集合 |
| ` SSIS-586 ` / `SSIS 586` | 原样 | 0 / 0 |
| `IPX-451` / `ipx451` | `IPX-451` | 9 / 9，同一结果集合 |
| `FC2-PPV-1234567` / `fc2ppv1234567` / `FC2-1234567` | 原样 | 0 / 0 / 0 |
| `259LUXU-1234` / `259luxu1234` | 原样 | 1 / 0 |
| `SSIS-586-C` / `ssis586c` | 原样 | 0 / 0 |
| 中文演员名 | 原样 | 259 |

14 次均为两个源成功响应的 complete 记录；零条并不表示请求失败，也不能用来证明两种特殊格式等价。只有常见字母前缀的已测写法证明了规范化等价，数字前缀、空格和后缀没有同等保证。本次没有引入聚合层关键词改写。

结构化证据：`frontend-verification/bytemuse-expanded-results.json`。发布前重新执行统计单测 8 项、后端 9 组、原功能浏览器 26 项、概览浏览器 9 项，均通过。前端检查使用隔离本地配置，不触碰生产源配置。

