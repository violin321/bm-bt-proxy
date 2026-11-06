# DB Online 扩展磁链接入修复

2026-11-07（Asia/Shanghai）。用户在 DB Online 添加公共磁链扩展库并开启 Nyaa 后，BM-BT 仍只返回影片详情中的资源。原因是适配器 0.1.0 只请求 `/api/video/{code}`，而 DB Online 网页另外请求 `/api/external-magnets/custom/{code}` 和 `/api/external-magnets/nyaa/{code}`。仅在应用设置里开启扩展库不会改变旧适配器的查询通道。

修复前已添加并运行 HTTP 契约回归：成功的扩展接口样本应出现在 `/api/torrents/custom` 结果中，原代码返回 404；修复后该回归通过。适配器更新为 0.2.0，保留原入口，并新增两个独立数据源：

| BM-BT 名称 | ID | URL |
|---|---|---|
| DB Online (公共扩展库) | `edb7bc3d` | `http://db_online_bt_adapter:9091/api/torrents/custom` |
| DB Online (Nyaa) | `cfac511a` | `http://db_online_bt_adapter:9091/api/torrents/nyaa` |

两源均已启用，GET、关键词字段 `keyword`、超时 30 秒、请求头空。扩展库 API Key／额外请求头仍由 DB Online 设置管理。Nyaa 源开关由 BM-BT 独立控制。原三个源对象、BM-BT API Key 及用户刚填写的 DB Online 配置保持不变。

## 真实结果

| 查询 | JavDB 原源 | Nyaa | 公共扩展库 |
|---|---|---|---|
| `SSIS-586` / `ssis586` | 17 条 | 各 15 条 | DB Online 上游失败，适配器返回 502 |
| `IPX-451` | 修复前详情样本 18 条 | 17 条 | DB Online 上游失败，适配器返回 502 |

`SSIS-586` 五源聚合：AVDB 8、修仙 6、JavDB 17、Nyaa 15；公共扩展库失败。跨源去重后 **26 条**，比此前三源聚合 17 条增加 9 条。统计正确记录为 `partial`，原源结果不会因公共库失败而被丢弃。GET `/api/torrents` 和 POST `/bt/api` 均确认返回同一资源集合。

公共扩展库在 DB Online 内直接查询也返回 `success=false`，错误为「上游 API 服务异常或暂时不可用」。本次修复已补齐其查询通道、字段转换和错误上报，但**未取得该公共库成功返回的真实样本**，不能宣称其上游已恢复。其成功响应通过离线契约样本验证；Nyaa 则与 DB Online 实际返回的资源哈希逐条一致。

## 防呆与验证

扩展接口 `title`／`download_url`／`post_time`／布尔标记转换为 Byte-Muse 格式，使用与原源相同的稳定 52 位整数 ID，并按 BTIH／ED2K 去重。常见番号规范化后直接查询；特殊格式直接保留结构查询，不依赖 JavDB 存在影片。普通文字最多展开三部影片。空关键词不访问上游，错误和超时分别为 502／504，不能伪装为成功零条。各分支共享两查询并发限额，含排队总计 22 秒，单次 HTTP 最多 10 秒。

- 本机和实际运行镜像各通过 20 项测试，包括扩展专属资源、Nyaa 路由、特殊番号、文字查询上限、跨片去重、上游错误、超时、无效结构、部分失败、原源隔离和输入限制。
- 实际 Byte-Muse v1.32.0 模型解析通过 JavDB 17 条和 Nyaa 15 条。
- 实际 Byte-Muse 网页对 `SSIS-586`、`ssis586` 均返回并渲染 26 条，结果签名一致，零未捕获 JS 异常。
- BM-BT 实际网页显示五源，四工作页在 1440／768／390／360 宽度无横向溢出，源编辑打开后取消通过，零未捕获 JS 异常。
- 仅重建适配器容器；BM-BT、DB Online、PostgreSQL、两个 Byte-Muse 和 AVDB 的容器 ID／启动时间保持不变。三个新栈容器均 healthy。

未修改 BM-BT 主程序或发布新 BM 镜像；适配器仅在 OVH 本地构建。未执行下载／订阅；未做物理手机和长期运行验收。结构化证据见 `frontend-verification/dbonline-extensions-results.json`。

## 回退

备份位于 `/root/docker/db-online/backup-ext-20261106T175611Z/`，包含更新前 Compose、适配器、私密配置和 BM-BT 请求数据库一致快照。断开扩展查询时先在 BM-BT 停用上述两个新源，原三个源不依赖扩展入口。必要时恢复旧适配器镜像及 Compose，不要用旧请求数据库覆盖之后的历史。
