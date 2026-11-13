# BM-BT-Proxy

Byte-Muse 多源 BT 聚合中继，提供 Web 控制台、并发搜索、去重、源诊断与可配置的返回顺序。支持 `linux/amd64` 和 `linux/arm64`。

源代码与完整说明：[GitHub · violin321/bm-bt-proxy](https://github.com/violin321/bm-bt-proxy)

## 快速部署

创建 `compose.yml`：

```yaml
services:
  bm-bt-proxy:
    image: violin321/bm-bt-proxy:1.10.0
    container_name: bm-bt-proxy
    restart: unless-stopped
    ports:
      - "8000:8000"
    volumes:
      - ./bm-bt-data:/data
    environment:
      TZ: Asia/Shanghai
      WEB_USERNAME: "${BM_WEB_USERNAME:?请设置管理账号}"
      WEB_PASSWORD: "${BM_WEB_PASSWORD:?请设置管理密码}"
      SECRET_KEY: "${BM_SECRET_KEY:?请设置固定随机签名密钥}"
```

在同目录 `.env` 设置 `BM_WEB_USERNAME`、`BM_WEB_PASSWORD`、`BM_SECRET_KEY`，然后执行 `docker compose up -d`。打开 `http://服务器地址:8000`，登录后添加自己的数据源并进行搜索测试。外网访问通过 HTTPS 反向代理。

管理账号和密码必须同时设置；缺少任一项时控制台不要求登录。`SECRET_KEY` 应固定保存，升级时沿用。`/data` 包含配置、凭据会话、统计与标签缓存，需要持久化和私有备份。

## 连接 Byte-Muse

打开“设置 → 连接 Byte-Muse”，选择能从 Byte-Muse 容器访问的地址，然后复制页面生成的 Compose 环境变量到 **Byte-Muse 服务**。同 Docker 网络的标准示例：

```yaml
BT_URL: "http://bm-bt-proxy:8000/api/torrents"
BT_METHOD: "get"
BT_HEADER: "{}"
BT_JSON_DATA: ""
```

如果启用“聚合接口保护”，以页面生成的 `BT_HEADER` 为准，其中包含实际 API Key。管理登录与搜索接口 API Key 分开配置。Byte-Muse 已持久保存的 BT 配置也需在其管理页核对。

## 主要功能

- 通用 GET / POST 数据源、独立搜索请求头和超时；原生 Jackett 站点选择。
- 多源并发查询、磁链／ED2K 去重、源优先级及部分失败诊断。
- 运行概览、请求趋势、最近响应与请求详情。状态代表最近一次请求，不表示源持续在线。
- 一个“搜索结果排序”区统一管理属性规则和分类／标签候选项。加入草稿、调整顺序并保存后生效；默认关闭。
- AVDB / 修仙兼容目录可用账号密码登录；支持 AVDB 二次验证码，保留高级 Cookie / Authorization。只保存校验成功的目录会话，不保存账号密码。会话过期需重新登录。
- 可选独立 DB Online 适配器，提供资源及缓存影片风格；不包含在主镜像中。
- 独立 LTX 优选接口 `/api/torrents/ltx`，只保留严格 `uc=true` 的资源，优先明确 LTX 标记，同时保留其他无码候选。

LTX 方案需将 Byte-Muse 默认排序设为 `uc`，保留原下载筛选；全部候选不合格时希望停止，使用 Byte-Muse 严格模式。上游 LTX 标签不证明实际使用的模型。[完整接入与边界](https://github.com/violin321/bm-bt-proxy/blob/main/docs/LTX-PREFERRED-20261108.md)

## 镜像与升级

- `1.10.0`：目录账号登录与排序设置整合。
- `latest`：最近的 `main` 构建，可能包含后续文档或其他修改。
- 生产部署可固定版本或镜像摘要。版本号相同不表示镜像相同，同时核对摘要和设置页构建编号。

升级前备份整个 `/data` 和部署配置，保留旧镜像，然后执行：

```bash
docker compose pull bm-bt-proxy
docker compose up -d --no-deps bm-bt-proxy
```

更新后检查登录、源查询、历史和目录缓存。健康检查仅验证 Web 服务响应。请求历史保留最近 30 天、最多 50,000 条；目录范围依源而异，不保证全站标签完整性。

[完整 README](https://github.com/violin321/bm-bt-proxy#readme) · [项目架构](https://github.com/violin321/bm-bt-proxy/blob/main/docs/OVERVIEW.md) · [版本记录](https://github.com/violin321/bm-bt-proxy/releases) · [DB Online 部署](https://github.com/violin321/bm-bt-proxy/blob/main/deploy/db-online/README.md)
