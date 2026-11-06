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

适配器 `0.2.0` 增加两个独立入口，可按需分别添加 BM-BT 源，其他字段与上表相同：

| 名称 | URL |
|---|---|
| `DB Online (公共扩展库)` | `http://db_online_bt_adapter:9091/api/torrents/custom` |
| `DB Online (Nyaa)` | `http://db_online_bt_adapter:9091/api/torrents/nyaa` |

`custom` 调用 db_online 的 `/api/external-magnets/custom/{code}`，使用其已启用的自定义库及请求头配置，不在 BM-BT 重复存储密钥。`nyaa` 调用 `/api/external-magnets/nyaa/{code}`；该 BM-BT 源开关独立控制是否查询 Nyaa，停用时也请在 BM-BT 关闭对应源。

扩展库与 JavDB 原源分别报告成功、零条、502 或 504，公共库故障不会丢弃原源的结果。常见番号规范化后直接查询扩展接口，无需先在 JavDB 找到影片；FC2、数字前缀及特殊后缀也支持直接查询。普通文字仍最多从搜索第一页取三部影片再查询扩展库。仅启用 DB Online 设置中的扩展库不会自动为旧版适配器建立此通道。

扩展接口中的 `title`、`download_url`、`post_time` 和布尔标记转换成 Byte-Muse 所需字段；重复磁力／ED2K 使用与原源一致的稳定整数 ID。BM-BT 继续按哈希跨源去重；扩展库的返回条数不代表新增唯一资源数。多个分支共享原有的两查询并发限额，整次含排队最多 22 秒。

常见字母前缀番号直接调用单片详情接口，例如 `SSIS-586`、`ssis586` 都查 `SSIS-586`；不会把数字前缀、FC2 或特殊后缀强行改成普通番号。普通文本和特殊格式使用原文搜索，最多展开第一页前三部影片的磁力／ED2K；这不是完整的演员作品检索。适配接口的 `meta.limited` 标记截断，当前 BM-BT 页面不会展示该额外字段。空关键词不扫描全部目录。

上游单次请求超时为 10 秒，整个适配查询含排队最多 22 秒，同时处理最多两个查询。鉴权失败、非 JSON、无效结构和部分影片详情失败返回 502；超时返回 504，不伪装成成功零条。已确认的「未找到影片」返回空列表。资源按 BTIH／ED2K 哈希去重，并提供 Byte-Muse 必需的整数 ID、大小、标题与下载链接；ID 保持在 JavaScript 安全整数范围。

following 和类别列表可用于 db_online 自己的发现／筛选页面。它们返回影片或分类，不能直接配置为 BM-BT 的种子源。本次没有向 BM-BT 添加分类浏览或风格筛选界面，也没有设置下载客户端或执行下载／订阅。

## 验证与维护

适配器协议回归：

```sh
python -m unittest discover -s deploy/db-online/adapter -p 'test_*.py' -v
```

需使用已安装 BM-BT 依赖的 Python 环境。测试涵盖 Byte-Muse 必需字段、编号、资源转换、去重、请求上限、未找到与鉴权错误的区分、部分失败、超时和对外错误脱敏。

升级前备份 `.env`、`data/` 和 PostgreSQL 逻辑备份。`cache/` 不作为数据库备份。应用版本升级先更新固定摘要，并单独验证本地 API Key、番号详情和 BM-BT 单源／聚合结果；不要直接将未经验证的 `latest` 提升为生产。

需要断开接入时，先在 BM-BT 停用该源；停止本 Compose 项目不会影响原两个源。不要删除持久化目录或使用 `down -v` 清理用户数据。OVH 本次具体路径、条数、持久化与消费端验收见 `docs/DBONLINE-20261107.md`。
