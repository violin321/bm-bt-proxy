# BM-BT-Proxy (`violin321/bm-bt-proxy`)

[![Docker Image](https://img.shields.io/badge/docker-violin321%2Fbm--bt--proxy-blue.svg)](https://hub.docker.com/r/violin321/bm-bt-proxy)
[![Architecture](https://img.shields.io/badge/arch-amd64%20%7C%20arm64-brightgreen.svg)]()

用于解决 **Byte-Muse** 仅支持单个 `BT_URL` 配置限制的轻量异步 BT 聚合中继服务，**自带现代化 WebUI 控制台**。

---

## 🌟 核心特性

- **现代 WebUI 控制台**：打开浏览器即可直接管理 BT 源，无需反复修改重启 Compose 文件。
- **在线联调与即时测试**：在 WebUI 上直接输入关键词（如番号/名称），实时测试各个源的响应耗时、状态码、返回结果，并查看去重效果。
- **多源混合聚合**：支持配置无限数量的外部 BT 源（支持 GET 与 POST 请求混合配置）。
- **独立请求头与鉴权**：可为每个 BT 源单独指定 Headers（如 `X-API-Key`、`Authorization` 等）。
- **持久化保存**：挂载 `/data` 目录即可持久化保存通过 WebUI 增删改的配置。
- **极小体积与多架构**：基于 Alpine Linux 构建，镜像体积仅 ~30MB，支持 `linux/amd64` 与 `linux/arm64`。

---

## 🚀 快速使用 (Docker Compose)

在你的 Byte-Muse `docker-compose.yml` 中直接加入 `bm-bt-proxy` 服务：

```yaml
version: '3.8'

services:
  # BT 多源聚合中继（自带 WebUI）
  bm-bt-proxy:
    image: violin321/bm-bt-proxy:latest
    container_name: bm-bt-proxy
    restart: always
    ports:
      - "8000:8000"   # 打开 http://<IP>:8000 进入 WebUI 控制台
    volumes:
      - ./data:/data  # 持久化保存 WebUI 配置的源列表
    environment:
      # 也支持首次启动时通过环境变量初始化源（可选）：
      - BT_SOURCE_1_URL=http://192.168.1.30:6969/api/v1/articles/torrents
      - BT_SOURCE_1_METHOD=POST
      - BT_SOURCE_1_HEADERS={"X-API-Key":"***"}
      - BT_SOURCE_1_FIELD=keyword
      - BT_SOURCE_1_TIMEOUT=10.0

      - BT_SOURCE_2_URL=http://192.168.1.30:3850/bt/api
      - BT_SOURCE_2_METHOD=GET
      - BT_SOURCE_2_FIELD=keyword
      - BT_SOURCE_2_TIMEOUT=10.0

  # Byte-Muse 服务
  byte-muse:
    image: envyafish/byte-muse:latest
    container_name: byte-muse
    restart: always
    ports:
      - "8044:3750"
    volumes:
      - ./data:/data
    environment:
      - TZ=Asia/Shanghai
      - 'PUID=0'
      - 'PGID=0'
      # 指向内部代理地址
      - BT_URL=http://bm-bt-proxy:8000/api/torrents?keyword=
      - BT_METHOD=GET
      - LICENSE_CODE=YOUR_LICENSE_CODE
    depends_on:
      - bm-bt-proxy
```

---

## 🖥️ WebUI 功能一览

浏览器访问 `http://<IP>:8000`：
1. **源列表**：开关启用/禁用、编辑 URL、修改 GET/POST 方法、超时与请求头。
2. **测试搜索**：选择单源或全源，输入测试关键词查看各源响应时间及合并返回的 JSON。
