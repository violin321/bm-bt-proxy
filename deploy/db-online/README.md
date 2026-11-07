# db_online 与 BM-BT 接入

部署独立的 db_online、PostgreSQL 16 和 BT 适配器。db_online 原生搜索返回影片列表，详情中的磁力与 ED2K 需要展开后才能作为 BM-BT 源。本适配器不改 BM-BT 主程序和原有源。

已验收第三方版本为 `1.16.102`，应用及 PostgreSQL 镜像使用固定摘要，见 `.env.example`。适配器复用正式 BM-BT 1.4.0 镜像中的 Python 运行环境，不另行安装浮动依赖。适配器镜像在部署服务器本地构建，没有上传公共镜像仓库。

## 部署

将本目录复制到服务器。复制 `.env.example` 为 `.env`，设置该服务器的 Tailscale 地址、BM-BT 所在网络，并为数据库及 db_online 本地 API Key 分别生成随机值，例如使用 `openssl rand -hex 32`。限制 `.env` 权限为 600；不要将实际值提交到仓库。

启动数据库和应用：

```sh
docker compose -p db-online --env-file .env up -d postgres db_online
```

应用的 9090 端口绑定在 loopback 和 Tailscale；PostgreSQL 和适配器没有宿主机端口。PostgreSQL 只有独立内部网络，db_online 另接 BM-BT 的现有网络访问外部影片服务。数据、缓存、日志及 PostgreSQL 数据分别保存在本目录的挂载目录。Compose 也设置了内存／CPU 限额和 Docker 日志轮转。

db_online 默认关闭登录时只允许其认可的内网地址，可能将 Tailscale 地址视为外网。首次设置可通过 SSH 本地转发访问服务器的 `127.0.0.1:9090`，在应用设置中启用本地访问密钥，并将本地 API Key 设置为 `.env` 中的 `DBONLINE_API_KEY`。这是本地服务鉴权，与 JavDB 上游 Authorization 是两套配置。

确认应用启动及设置完成后构建适配器：

```sh
docker compose -p db-online --env-file .env up -d --build bt-adapter
docker compose -p db-online --env-file .env ps
```

应用健康检查携带本地 API Key 请求 `/api/ready`；检查命令只引用容器环境变量。适配器健康检查验证自身 HTTP 服务，真实上游可用性通过 BM-BT 的「单源测试」确认。

## BM-BT 源配置

| 字段 | 值 |
|---|---|
| 名称 | `DB Online (JavDB)` |
| URL | `http://db_online_bt_adapter:9091/api/torrents` |
| 方法 | `GET` |
| 关键词字段 | `keyword` |
| 超时 | `30` 秒 |
| 请求头 | 空对象 |

外部客户端继续使用原 BM-BT 地址和 API Key，不需要访问适配器。适配器内部使用独立的 db_online 本地 API Key。

### 扩展磁链库与 Nyaa

适配器 `0.2.0` 增加两个独立入口，可按需分别添加 BM-BT 源，其他字段与上表相同。`0.2.1` 进一步保留资源的原始 `tags`，将标签“字幕”识别为 `chinese=true`；Nyaa 的原始布尔属性放在 `upstream_flags` 中供诊断，不会将 `hd` 自动当成新的排序条件：

| 名称 | URL |
|---|---|
| `DB Online (公共扩展库)` | `http://db_online_bt_adapter:9091/api/torrents/custom` |
| `DB Online (Nyaa)` | `http://db_online_bt_adapter:9091/api/torrents/nyaa` |

`custom` 调用 db_online 的 `/api/external-magnets/custom/{code}`，使用其已启用的自定义库及请求头配置，不在 BM-BT 重复存储密钥。`nyaa` 调用 `/api/external-magnets/nyaa/{code}`；该 BM-BT 源开关独立控制是否查询 Nyaa，停用时也请在 BM-BT 关闭对应源。

扩展库与 JavDB 原源分别报告成功、零条、502 或 504，公共库故障不会丢弃原源的结果。常见番号规范化后直接查询扩展接口，无需先在 JavDB 找到影片；FC2、数字前缀及特殊后缀也支持直接查询。普通文字仍最多从搜索第一页取三部影片再查询扩展库。仅启用 DB Online 设置中的扩展库不会自动为旧版适配器建立此通道。

扩展接口中的 `title`、`download_url`、`post_time` 和布尔标记转换成 Byte-Muse 所需字段；重复磁力／ED2K 使用与原源一致的稳定整数 ID。BM-BT 继续按哈希跨源去重；扩展库的返回条数不代表新增唯一资源数。多个分支共享原有的两查询并发限额，整次含排队最多 22 秒。

常见字母前缀番号直接调用单片详情接口，例如 `SSIS-586`、`ssis586` 都查 `SSIS-586`；不会把数字前缀、FC2 或特殊后缀强行改成普通番号。普通文本和特殊格式使用原文搜索，最多展开第一页前三部影片的磁力／ED2K；这不是完整的演员作品检索。适配接口的 `meta.limited` 标记截断，当前 BM-BT 页面不会展示该额外字段。空关键词不扫描全部目录。

上游单次请求超时为 10 秒，整个适配查询含排队最多 22 秒，同时处理最多两个查询。鉴权失败、非 JSON、无效结构和部分影片详情失败返回 502；超时返回 504，不伪装成成功零条。已确认的「未找到影片」返回空列表。资源按 BTIH／ED2K 哈希去重，并提供 Byte-Muse 必需的整数 ID、大小、标题与下载链接；ID 保持在 JavaScript 安全整数范围。

### 影片风格与关键词排序（适配器 0.3.0）

JavDB 关键词／番号搜索会把影片详情的 `categories[].name` 作为每条资源独立的 `genres` 返回，磁链自己的 `tags` 保持原样。影片风格中的“4K”“破解”不推导磁链的 `uhd/uc`，资源规格仍由该磁链原有信息决定。扩展库与 Nyaa 不增加影片详情请求，返回空 `genres`。

`GET /api/catalog/genres` 只读取 DB Online 的 `/api/options/categories`，提供 Following 所用的风格名称集合。响应包含 `provider=db_online`、`coverage=cached_movies`、`labels` 和 `limited`。这是本地已缓存影片的风格集合，不是 JavDB 全站风格全集；最多 1000 个名称，逐条清洗，不会把整个目录截成单资源的 32 项限制。目录共用原请求并发限额，含排队最多 8 秒，失败返回固定脱敏的 502/504。

配套 BM-BT 版本会自动尝试 `/api/torrents` 同路径下的 `/api/catalog/genres`，要求上述契约标记才接收目录，扩展入口不做此探测。设置 → 分类与标签目录 → 内容类型“影片风格”，点击风格会加入限定来源与 `genres` 字段的排序草稿，保存后生效。目录刷新与搜索独立；目录失败保留旧缓存，原磁链搜索继续工作。

同一影片所有磁链共享影片风格，因此这种排序主要用于多影片关键词结果。同一番号下，仍需磁链标签或中字／无码／清晰度等资源属性区分各版本。已有跨源去重仍保留胜出源的数据，不从丢弃记录借用风格；没有风格的资源继续保留，规则默认关闭。Following 的最多 5 项属于它自己的发现筛选，本功能沿用 BM-BT 最多 24 条排序规则。

Following 返回影片列表，不能直接配置为 BM-BT 的种子源；本功能只复用风格元数据，不读取 Following 列表或创建订阅、下载任务。接入需要同时更新 BM-BT 主程序和重建 `bt-adapter`；仅升级一方不会完成目录与搜索风格的完整闭环。

## 验证与维护

适配器协议回归：

```sh
python -m unittest discover -s deploy/db-online/adapter -p 'test_*.py' -v
```

需使用已安装 BM-BT 依赖的 Python 环境。测试涵盖 Byte-Muse 必需字段、编号、资源转换、去重、请求上限、未找到与鉴权错误的区分、部分失败、超时和对外错误脱敏，以及影片风格与资源属性隔离、目录完整性和错误隔离。核心联调契约可运行 `PYTHONPATH=. python frontend-verification/dbonline-genres-contracts.py`。2026-11-07 候选验收与上线状态见 `docs/DBONLINE-GENRES-20261107.md`。

升级前备份 `.env`、`data/` 和 PostgreSQL 逻辑备份。`cache/` 不作为数据库备份。应用版本升级先更新固定摘要，并单独验证本地 API Key、番号详情和 BM-BT 单源／聚合结果；不要直接将未经验证的 `latest` 提升为生产。

需要断开接入时，先在 BM-BT 停用该源；停止本 Compose 项目不会影响原两个源。不要删除持久化目录或使用 `down -v` 清理用户数据。OVH 本次具体路径、条数、持久化与消费端验收见 `docs/DBONLINE-20261107.md`。
