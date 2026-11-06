# 1.4.0 OVH 部署与验收记录

日期：2026-11-06（Asia/Shanghai）。用户确认按建议执行代码冻结、隔离预发布、真实源及消费端检查，随后备份并更新正式服务。

## 交付版本

- 应用提交：`e7b8371e49f3e43bd286972b904845ca687cead7`，分支 `codex/frontend-redesign`；本文和结构化证据为后续文档提交，不改变已部署镜像。
- 正式容器：`bm-bt-proxy`；原公网 `8008 → 8000` 端口保持不变，API 版本 `1.4.0`。
- 固定镜像：`bm-bt-proxy:1.4.0-e7b8371`。
- 镜像 ID：`sha256:44b14fe43a7da53a3af3bbf0abbdf5846afd2f0369ad0fc4f941630755a4ee96`。
- 旧版镜像 ID：`sha256:2dbe9471ff0d16324c43d7619e0e8b8f5a9bf28b0737e97baddfd13f63af51e6`。
- 基础镜像：`python:3.11-alpine`，构建时摘要 `sha256:bb1d70c1df30d8ee1e05214dbe82d6cdfd29833c1f47ce917f20991aca93acaa`。

镜像在 OVH 构建并运行，未上传公共镜像仓库。原 requirements 的浮动约束没有改动；实际安装版本另存 `frontend-verification/release-dependencies.txt`。后续重建应使用保存镜像或这些确切依赖，并核对基础镜像摘要，不能假设再次构建会产生相同内容。

## 部署过程与配置保留

先使用独立复制的数据目录，在同一组上游网络运行 `bm-bt-proxy-stage`。仅绑定 OVH 的 loopback／Tailscale `18008` 端口。受控 401、超时和 API Key 开关检查仅在预发布数据上执行，未将这份测试数据提升到生产。

正式更新前再次备份，使用原生产数据挂载 `/root/docker/bm-bt-proxy-prod/data:/data`，只重建 `bm-bt-proxy` 服务。没有执行生产项目的 `down`，未重建 AVDB、Byte-Muse 或其它服务。

正式 compose 为 `/root/docker/bm-bt-proxy-prod/docker-compose.yml`，已固定上述新镜像，并声明两个实际存在的外部网络 `avdb_default` 和 `bm-bt-proxy-prod_default`。原 compose 仅声明默认网络；更新时将原容器另行连接的 AVDB 网络一起写入，防止以后重建丢失。Compose 的环境变量插值已在服务器内部比对实际值，不在文档保存凭据。

升级前后验证：`WEB_USERNAME`／`WEB_PASSWORD` 完全一致，`config.json` 字节完全一致，源 ID、请求头、超时、接口 URL、API Key 配置保持原值；升级前签发的 Cookie 在升级及后续一次受控重启后都有效。

## 验证结果

| 检查 | 实际结果 |
|---|---|
| 隔离预发布真实源 | AVDB 2 条、修仙 6 条，聚合 8 条；去重键无重复 |
| 预发布业务与鉴权 | 两个接口别名 GET／POST、query／header API Key、无认证管理接口拒绝访问、登录正确／错误路径通过 |
| 预发布异常分类 | 受控 HTTP 401、超时、全部失败、部分成功均按实际上游结果入库；测试后配置完全恢复 |
| 预发布容器重启 | 12 条测试记录、源历史、配置和旧 Cookie 保留，SQLite quick_check 为 ok |
| 正式真实双源诊断 | AVDB HTTP 200，94 ms，2 条；修仙 HTTP 200，1,259 ms，6 条；聚合 8 条 |
| 正式业务路由 | `/api/torrents` GET 与 `/bt/api` POST 返回真实结果，管理设置及统计在未认证时为 401 |
| 正式容器重启 | 4 条验收请求记录保留，旧 Cookie 仍有效，配置未变，SQLite quick_check 为 ok |
| 消费端网络 | 在现有 `byte-muse` 容器内分别请求预发布和正式接口，均返回 8 条 |
| 实际远程浏览器 | 真实登录、两源概览、四个工作页；1440／768／390／360 宽无横向溢出；手机宽度源编辑及删除入口可打开并取消；零未捕获 JS 异常 |
| 公网入口 | 从 Mac 请求原公网 `8008` 的 OpenAPI 返回 1.4.0，未登录首页跳转登录页 |
| 容器状态 | 最终 healthy，RestartCount 为 0，OOMKilled 为 false；手动验收重启不计入 RestartCount |

首轮预发布曾出现修仙 10.7 秒超时，AVDB 正常。随后只读诊断中 Tailscale ping 建立直连，TCP 6969、旧版正式接口和新预发布源测试均成功；完整预发布重跑及正式检查通过。未更改 Tailscale 或源站配置，根因未确证，不能据此宣称网络问题已永久修复。

真实封面字段透传并做两次有界请求检查：分别为 HTTP 403／text/html、HTTP 200／image/jpeg。没有保留媒体、伪造封面或新增图片代理；这不是所有海报均可加载的证明。

正式初始 4 条记录均为本轮真实验收请求，共 32 条去重后结果，并非历史用户流量。预发布记录另含受控失败，不混入生产统计。统计只从 1.4.0 启用后开始，不补录以前数据。

Byte-Muse 持久配置的 `BT_URL` 在检查时为空，本轮未修改其接入配置。消费端证据为其现有容器网络内的真实 HTTP 请求，尚未完成整个消费端 UI 发起搜索的验收。

同日后续用户要求新建隔离 Byte-Muse 实测，已在独立数据与端口下完成六种番号写法的真实接口和网页搜索；现有 Byte-Muse 配置仍未修改。该新增证据见 `BYTEMUSE-SEARCH-20261106.md`，与本次生产更新当时的消费端边界分别记录。

结构化证据：`frontend-verification/live-release-results.json`。实际远程页面截图保存在本地 `.impeccable/review/live-production-{1440,390}.png`，无账号、请求头或 API Key。

## 备份与回滚

服务器发布目录：

```text
/root/docker/bm-bt-proxy-releases/1.4.0-e7b8371
```

正式更新前的备份：

```text
backup-before-production-20261106T130640Z/
  docker-compose.yml
  data/
  container-inspect.json
```

目录及含访问配置的文件限制访问，不提交到仓库。另保留 `backup-before-stage/`、原版镜像标签 `bm-bt-proxy:rollback-20261106-e7b8371`、`rollback-compose.json`、`rollback.py`、源码包、依赖清单和两版应用镜像离线包。

应用回退命令（在 OVH 执行）：

```sh
python3 /root/docker/bm-bt-proxy-releases/1.4.0-e7b8371/rollback.py
docker inspect --format '{{.State.Status}}' bm-bt-proxy
```

回退脚本使用固定旧镜像并保留生产数据及两个网络。不会用备份覆盖升级后的请求历史。原版没有新镜像的 HEALTHCHECK，回退后应再检查登录、两个真实源及业务接口。

如镜像标签已被清理，可先从保存的离线包加载：

```sh
cd /root/docker/bm-bt-proxy-releases/1.4.0-e7b8371
sha256sum -c application-images.sha256
docker load -i application-images.tar
python3 rollback.py
```

离线镜像包共 157,900,800 字节，SHA-256 为 `6897d0481b8e77c7764d09544cbcef69a4356244468f361089e37ecb82bdc25e`。本轮保存了回退路径和自动失败回退处理，但成功升级后没有再执行降级演练。

## 清理与边界

验收后移除临时预发布容器及 `18008` 监听，保留隔离证据和备份。生产继续使用原端口和生产数据。临时本地浏览器凭据文件在验收后删除。

未完成物理手机、读屏、完整消费端 UI、持续弱网及长时间运行验收；没有新增源分享平台。本轮没有合并到 main、修改发布工作流或公开发布镜像。后续 main 合并与镜像发布应沿用本次真实源、旧配置和重启保留检查。

2026-11-07 已完成正式公共镜像发布及 OVH 固定摘要提升，后续状态以 `RELEASE-20261107.md` 和 GitHub Release 验收附件为准。
